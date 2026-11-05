import { onWindows } from "./platform.js";

export const AGENTS = {
  "claude-code": { label: "Claude Code", images: "mention" },
  codex: { label: "Codex", images: "paste" },
  pi: { label: "Pi", images: "path" },
};

export const SUPPORTED = Object.fromEntries(Object.entries(AGENTS).map(([app, a]) => [app, a.label]));

export function imageStyle(app) {
  // How this agent gets images here: pasting needs a pty, so Windows sends Codex the plain path.
  const style = AGENTS[app]?.images ?? "path";
  return style === "paste" && onWindows() ? "path" : style;
}

export function canMirror(app) {
  // Whether the chat and this agent's own box keep one draft (input-box.py needs a pty: not on Windows).
  return Boolean(AGENTS[app]) && !onWindows();
}

function mention(path) { return /\s/.test(path) ? `@"${path}"` : `@${path}`; }

export function withImages(app, paths, text) {
  // The message as sent: images named the agent's way ahead of the text (pasted ones went first).
  if (!paths.length) return text;
  const style = imageStyle(app);
  if (style === "paste") return text;
  const refs = paths.map(p => style === "mention" ? mention(p) : p);
  return [refs.join(" "), text].filter(Boolean).join(" ");
}

export function draftPastes(app, paths, text) {
  // The chat's draft as the agent's own box shows it.
  if (app === "codex") return { pastes: [...paths, text], pasted: text };
  const refs = paths.map(p => app === "claude-code" ? mention(p) : p);
  const pasted = [refs.join(" "), text].filter(Boolean).join(" ");
  return { pastes: [pasted], pasted };
}

export function textOfBox(app, box) {
  // What the text became in the box, the images left out (a long paste folds into a placeholder).
  return app === "codex" ? box.replace(/\[Image #\d+\]\s?/g, "").trim() : box;
}

export function readBack(app, box, m) {
  // The agent's box read back into the chat's draft.
  let s = box;
  if (m && m.textBox && m.textBox !== m.pasted && s.includes(m.textBox)) s = s.replace(m.textBox, m.pasted);
  const kept = [];
  let foreign = false;
  const ours = i => (m && i >= 0 && i < m.images.length ? m.images[i] : null);
  if (app === "codex") {
    s = s.replace(/\[Image #(\d+)\]\s?/g, (all, k) => { const a = ours(Number(k) - 1); if (a) { kept.push(a); return ""; } foreign = true; return all; });
  } else if (app === "claude-code") {
    s = s.replace(/@"([^"]+)"\s?|@(\S+)\s?/g, (all, quoted, bare) => { const a = ours(m ? m.paths.indexOf(quoted ?? bare) : -1); if (a) { kept.push(a); return ""; } return all; });
    if (/\[Image #\d+\]/.test(s)) foreign = true;
  } else if (m) {
    m.paths.forEach((path, i) => { if (s.includes(path)) { kept.push(m.images[i]); s = s.replace(path, "").replace(/^\s+/, ""); } });
  }
  return { text: s.replace(/^\s+/, ""), kept, foreign };
}
