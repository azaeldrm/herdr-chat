// What the chat knows about each agent it shows: its name, how a message carries an image, and how
// its own input box shows the chat's draft. Each was checked in the agent's own session log.
import { onWindows } from "./platform.js";

export const AGENTS = {
  // attaches an @-mentioned image file to the message, up to about 256 KB (the prepare scripts
  // shrink bigger ones)
  "claude-code": { label: "Claude Code", images: "mention" },
  // attaches a pasted path only when the paste holds nothing else ([Image #N]): each path is pasted
  // alone first, without Enter, then the text is sent
  codex: { label: "Codex", images: "paste" },
  // never attaches: its own Ctrl+V saves the image and inserts the path as text, and its model opens
  // it with the read tool, so the plain path is Pi's native form
  pi: { label: "Pi", images: "path" },
};

export const SUPPORTED = Object.fromEntries(Object.entries(AGENTS).map(([app, a]) => [app, a.label]));

/** How this agent gets images here: pasting needs a pty, so Windows sends Codex the plain path. */
export function imageStyle(app) {
  const style = AGENTS[app]?.images ?? "path";
  return style === "paste" && onWindows() ? "path" : style;
}

/** Whether the chat and this agent's own box keep one draft (input-box.py needs a pty: not on Windows). */
export function canMirror(app) { return Boolean(AGENTS[app]) && !onWindows(); }

function mention(path) { return /\s/.test(path) ? `@"${path}"` : `@${path}`; }

/** The message as sent: images named the agent's way ahead of the text (pasted ones went first). */
export function withImages(app, paths, text) {
  if (!paths.length) return text;
  const style = imageStyle(app);
  if (style === "paste") return text;
  const refs = paths.map(p => style === "mention" ? mention(p) : p);
  return [refs.join(" "), text].filter(Boolean).join(" ");
}

/**
 * The chat's draft as the agent's own box shows it: the pastes that put it there, and what was
 * pasted for the text (Claude Code: @mentions then the text; Codex: each path alone, then the text;
 * Pi: plain paths then the text).
 */
export function draftPastes(app, paths, text) {
  if (app === "codex") return { pastes: [...paths, text], pasted: text };
  const refs = paths.map(p => app === "claude-code" ? mention(p) : p);
  const pasted = [refs.join(" "), text].filter(Boolean).join(" ");
  return { pastes: [pasted], pasted };
}

/** What the text became in the box, the images left out (a long paste folds into a placeholder). */
export function textOfBox(app, box) {
  return app === "codex" ? box.replace(/\[Image #\d+\]\s?/g, "").trim() : box;
}

/**
 * The agent's box read back into the chat's draft. `m` is what the chat last put there: its images
 * (`images`, `paths` as placed beside the terminal), what it pasted for the text (`pasted`) and what
 * that became in the box (`textBox`). Returns the text, the chat's images still in the box, and
 * whether an image pasted in the terminal itself is there (the agent keeps it; it can't come back).
 */
export function readBack(app, box, m) {
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
