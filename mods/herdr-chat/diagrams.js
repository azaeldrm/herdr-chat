// Mermaid diagrams in the chat, drawn by Pele (vendor/pele, copied by scripts/vendor-pele.mjs).
// Pele colors its SVG through CSS variables, which herdr's SVG renderer ignores (shapes come out
// black, text missing), so the theme's colors are written into the SVG before it's saved under
// cache/herdr-chat/diagrams/ for image(), which reads only from the herdr home. Rendering happens
// from the chat's timer, one diagram per tick, never while drawing.
import { appHome } from "herdr";
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
import { hash } from "./common.js";
import { onWindows } from "./platform.js";

register(flowchart, sequence, state, klass, er, gantt, pie, mindmap, timeline, gitGraph);

const DIR = "cache/herdr-chat/diagrams";
const KEPT = 200;
const entries = new Map(); // key -> { key, source, colors, state: "queued" | "ready" | "failed", rel, width, height, error }
const queue = [];
const sourceShown = new Set();
let version = 0;

/** Changes whenever a diagram finishes or flips between picture and source: rows holding one re-measure. */
export function diagramsVersion() { return version; }

// herdr's SVG renderer finds only fonts installed on the system, not the Geist herdr draws its own
// text with: a lone "Geist" fell back to a symbol font (Latin letters drawn as Greek). So each family
// is a list: Geist and JetBrains Mono where installed, then common ones on Linux, Windows and macOS.
const SANS = "Geist, 'Noto Sans', 'Liberation Sans', 'DejaVu Sans', 'Segoe UI', Arial, Helvetica, sans-serif";
const MONO = "'JetBrains Mono', 'Noto Sans Mono', 'Liberation Mono', 'DejaVu Sans Mono', Consolas, Menlo, monospace";

/** Pele's variables, as the theme fills them: its colors, and the font families. */
function colorsOf(t) {
  const c = v => String(v ?? "").slice(0, 7);
  return { bg: c(t.background), fg: c(t.foreground), muted: c(t.muted), line: c(t.muted), surface: c(t.surface),
    "surface-alt": c(t.raised), border: c(t.border), accent: c(t.accent), font: SANS, "font-mono": MONO };
}

/**
 * Pele's SVG with the colors written in. Its root defines short variables from its public ones
 * (`--_bg:var(--pele-bg,#fff)`) and shapes use the short ones (`fill="var(--_bg)"`): each short one
 * becomes the theme's color (or Pele's default for one the theme doesn't set), corner radii become
 * attributes, and the font family a plain name. Variables used directly (series colors) get the
 * theme's color too, else Pele's default palette.
 */
export function bake(svg, colors) {
  const short = {};
  svg = svg.replace(/--(_[a-z]+):var\(--pele-([a-z-]+),([^)]*)\);?/g, (_all, name, pele, fallback) => {
    short[name] = colors[pele] || fallback; return "";
  });
  svg = svg.replace(/var\(--(_[a-z]+)\)/g, (all, name) => short[name] ?? all);
  // the rest name Pele's variables directly (series colors in pies, mind maps, timelines, git graphs)
  svg = svg.replace(/var\(--pele-([a-z0-9-]+),([^)]*)\)/g, (_all, pele, fallback) => colors[pele] || fallback);
  return svg.replace(/style="rx:([\d.]+)px"/g, 'rx="$1"')
    .replace(/font-family:var\(--pele-font,([^)]*)\)/g, (_all, fallback) => `font-family:${colors.font || fallback}`);
}

/** The diagram for `source` in this theme: queued for drawing the first time it's asked for. */
export function diagramFor(source, t) {
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

export function showingSource(e) { return sourceShown.has(e.source); }
export function toggleSource(e) { sourceShown.has(e.source) ? sourceShown.delete(e.source) : sourceShown.add(e.source); version++; }

/** Draws the next queued diagram; resolves true when one finished (drawn or failed). */
export async function renderNextDiagram() {
  const e = queue.shift();
  if (!e) return false;
  try {
    const r = render(e.source, { fontFamily: "Geist" });
    const dir = onWindows() ? `${appHome()}\\cache\\herdr-chat\\diagrams` : `${appHome()}/${DIR}`;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(onWindows() ? `${dir}\\${e.key}.svg` : `${dir}/${e.key}.svg`, bake(r.svg, e.colors));
    Object.assign(e, { state: "ready", rel: `${DIR}/${e.key}.svg`, width: r.width, height: r.height });
  } catch (err) {
    Object.assign(e, { state: "failed", error: String(err?.message ?? err).split("\n")[0] });
  }
  version++;
  return true;
}

/** An assistant message split around its ```mermaid blocks: text, a diagram row, text, … */
export function splitDiagrams(text) {
  const parts = text.split(/```mermaid[^\n]*\n([\s\S]*?)```/g);
  if (parts.length === 1) return null;
  const out = [];
  parts.forEach((p, i) => {
    if (i % 2) out.push({ kind: "diagram", text: p.trim() });
    else if (p.trim()) out.push({ kind: "text", text: p.trim() });
  });
  return out;
}
