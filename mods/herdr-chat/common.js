// What the chat panel and the terminal header share.
import { run, shared, setShared, terminals } from "herdr";

// Agents whose session logs read-session.ps1 can read, with the names people know them by.
export const SUPPORTED = { "claude-code": "Claude Code", codex: "Codex", pi: "Pi" };
export const ICONS = "mods/herdr-chat/icons";

// Every session starts in the terminal; one you switch to the chat stays a chat. The choice is
// kept per session in herdr's shared state, which survives restarts.
const VIEWS_KEY = "herdr-chat.views"; // { "<terminal>:<created ms>": "chat" | "terminal" }
const VIEWS_KEPT = 200;               // the most recent sessions remembered

// One agent session: the terminal plus when it started, so a reused address starts fresh.
export function sessionKey(address) {
  const term = terminals().find(x => x.address === address);
  return term ? `${address}:${term.created_ms ?? 0}` : "";
}

// The view this session was last left in; the terminal until you choose the chat.
export function preferredView(key) {
  return (shared(VIEWS_KEY) ?? {})[key] === "chat" ? "chat" : "terminal";
}

function remember(key, mode) {
  if (!key) return;
  const views = { ...(shared(VIEWS_KEY) ?? {}) };
  delete views[key];
  views[key] = mode; // newest last, so trimming drops the oldest
  const keys = Object.keys(views);
  for (const k of keys.slice(0, Math.max(0, keys.length - VIEWS_KEPT))) delete views[k];
  setShared(VIEWS_KEY, views);
}

// The layout holds the chat and the terminal in one stack ("chat-view"); this picks which shows.
// Without that stack in the layout, it does nothing. With a session key, the choice is remembered.
export function switchTo(mode, key) {
  if (key) remember(key, mode);
  showView(mode);
}

// Shows a view without remembering it (the chat panel applies saved choices this way).
export function showView(mode) {
  setShared("herdr-chat.mode", mode);
  if (mode === "chat") setShared("herdr-chat.visit", Date.now()); // the chat opens at the newest message
  run("layout.select", { stack: "chat-view", child: mode === "terminal" ? "terminal-panel" : "chat-panel" });
}

