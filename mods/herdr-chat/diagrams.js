import { appHome, exec } from "herdr";
import * as fs from "fs/promises";
import { register, render } from "./vendor/pele/core.js";
import flowchart from "./vendor/pele/diagrams/flowchart.js";
import sequence from "./vendor/pele/diagrams/sequence.js";
import state from "./vendor/pele/diagrams/state.js";
import klass from "./vendor/pele/diagrams/class.js";
import er from "./vendor/pele/diagrams/er.js";
import gantt from "./vendor/pele/diagrams/gantt.js";
import pie from "./vendor/pele/diagrams/pie.js";
import mindmap from "./vendor/pele/diagrams/mindmap.js";
import timeline from "./vendor/pele/diagrams/timeline.js";
import gitGraph from "./vendor/pele/diagrams/gitGraph.js";
import { hash } from "./model/hash.js";
import { onWindows, modFile } from "./platform.js";

register(flowchart, sequence, state, klass, er, gantt, pie, mindmap, timeline, gitGraph);

const DIR = "cache/herdr-chat/diagrams";
const KEPT = 200;
const entries = new Map();
const queue = [];

const SANS = "Geist, 'Noto Sans', 'Liberation Sans', 'DejaVu Sans', 'Segoe UI', Arial, Helvetica, sans-serif";
const MONO = "'JetBrains Mono', 'Noto Sans Mono', 'Liberation Mono', 'DejaVu Sans Mono', Consolas, Menlo, monospace";

function colorsOf(t) {
  // Pele's variables, as the theme fills them: its colors, and the font families.
  const c = v => String(v ?? "").slice(0, 7);
  return { bg: c(t.background), fg: c(t.foreground), muted: c(t.muted), line: c(t.muted), surface: c(t.surface),
    "surface-alt": c(t.raised), border: c(t.border), accent: c(t.accent), font: SANS, "font-mono": MONO };
}

export function bake(svg, colors) {
  // Pele's SVG with the colors written in.
  const short = {};
  svg = svg.replace(/--(_[a-z]+):var\(--pele-([a-z-]+),([^)]*)\);?/g, (_all, name, pele, fallback) => {
    short[name] = colors[pele] || fallback; return "";
  });
  svg = svg.replace(/var\(--(_[a-z]+)\)/g, (all, name) => short[name] ?? all);
  svg = svg.replace(/var\(--pele-([a-z0-9-]+),([^)]*)\)/g, (_all, pele, fallback) => colors[pele] || fallback);
  return svg.replace(/style="rx:([\d.]+)px"/g, 'rx="$1"')
    .replace(/font-family:var\(--pele-font,([^)]*)\)/g, (_all, fallback) => `font-family:${colors.font || fallback}`);
}

export function diagramFor(source, t) {
  // The diagram for `source` in this theme: queued for drawing the first time it's asked for.
  const colors = colorsOf(t);
  const key = hash(`${source}\u0000${JSON.stringify(colors)}`);
  let e = entries.get(key);
  if (!e) {
    e = { key, source, colors, state: "queued" };
    entries.set(key, e);
    queue.push(e);
    while (entries.size > KEPT) entries.delete(entries.keys().next().value);
  }
  return e;
}

export function hasQueuedDiagrams() { return queue.length > 0; }

export async function renderQueuedDiagrams(budgetMs = 40) {
  // Draws queued diagrams with Pele, as many as fit in `budgetMs` (at least one).
  const start = Date.now(), done = [];
  while (queue.length && (done.length === 0 || Date.now() - start < budgetMs)) {
    const e = queue.shift();
    try { done.push([e, render(e.source, { fontFamily: "Geist" })]); }
    catch (err) { Object.assign(e, { state: "failed", error: String(err?.message ?? err).split("\n")[0] }); done.push([e, null]); }
  }
  if (!done.length) return 0;
  const dir = onWindows() ? `${appHome()}\\cache\\herdr-chat\\diagrams` : `${appHome()}/${DIR}`;
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  await Promise.all(done.filter(([, r]) => r).map(async ([e, r]) => {
    try {
      await fs.writeFile(onWindows() ? `${dir}\\${e.key}.svg` : `${dir}/${e.key}.svg`, bake(r.svg, e.colors));
      Object.assign(e, { state: "ready", rel: `${DIR}/${e.key}.svg`, width: r.width, height: r.height });
    } catch (err) { Object.assign(e, { state: "failed", error: String(err?.message ?? err).split("\n")[0] }); }
  }));
  return done.length;
}

export function splitDiagrams(text) {
  // An assistant message split around its ```mermaid blocks: text, a diagram row, text, …
  const parts = text.split(/```mermaid[^\n]*\n([\s\S]*?)```/g);
  if (parts.length === 1) return null;
  const out = [];
  parts.forEach((p, i) => {
    if (i % 2) out.push({ kind: "diagram", text: p.trim() });
    else if (p.trim()) out.push({ kind: "text", text: p.trim() });
  });
  return out;
}

export const COPY_PAD = 24;

export function framedSvg(svg, width, height, background, pad = COPY_PAD) {
  // A drawn diagram's SVG on its own background with `pad` px around it, at its own size: what's copied as a picture, so its
  // light text stays readable wherever it's pasted.
  const w = width + 2 * pad, h = height + 2 * pad;
  return svg.replace(/<svg\s[^>]*>/, tag => tag
    .replace(/viewBox="[^"]*"/, `viewBox="${-pad} ${-pad} ${w} ${h}"`)
    .replace(/\swidth="[^"]*"/, ` width="${w}"`)
    .replace(/\sheight="[^"]*"/, ` height="${h}"`)
    .replace(/max-width:100%;height:auto;/, "")
    + `<rect x="${-pad}" y="${-pad}" width="${w}" height="${h}" fill="${background}"/>`);
}

const COPY_ERRORS = {
  3: onWindows() ? "Copying a picture needs Microsoft Edge or Google Chrome." : "Copying a picture needs rsvg-convert (librsvg), ImageMagick or Inkscape.",
  4: "The diagram couldn't be drawn as a picture.",
  5: "Copying a picture needs wl-copy or xclip.",
};

export async function copyDiagramImage(d, background) {
  // Puts a drawn diagram (diagramFor, ready) on the clipboard as a PNG; null when done, else why not.
  const dir = onWindows() ? `${appHome()}\\cache\\herdr-chat\\diagrams` : `${appHome()}/${DIR}`;
  const at = name => onWindows() ? `${dir}\\${name}` : `${dir}/${name}`;
  const svg = at(`${d.key}.copy.svg`), png = at(`${d.key}.copy.png`);
  const w = Math.ceil(d.width) + 2 * COPY_PAD, h = Math.ceil(d.height) + 2 * COPY_PAD;
  try { await fs.writeFile(svg, framedSvg(await fs.readFile(at(`${d.key}.svg`), "utf8"), Math.ceil(d.width), Math.ceil(d.height), background)); }
  catch (e) { return String(e?.message ?? e); }
  const r = await (onWindows()
    ? exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", modFile("copy-image.ps1"), "-Svg", svg, "-Png", png, "-Width", String(w), "-Height", String(h)])
    : exec("sh", [modFile("copy-image.sh"), svg, png, String(w), String(h)])).catch(e => ({ code: -1, stderr: String(e) }));
  return r.code === 0 ? null : COPY_ERRORS[r.code] ?? ((r.stderr || "").trim().split("\n").pop() || "The picture couldn't be copied.");
}
