import { run, shared, setShared, terminals, layout } from "herdr";

export { SUPPORTED } from "./harnesses/index.js";
export const ICONS = "mods/herdr-chat/icons";

const VIEWS_KEY = "herdr-chat.views";
const VIEWS_KEPT = 200;

export function sessionOf(t) {
  // A session: one program's run in a terminal (an address is reused once its terminal ends).
  return t ? `${t.address}:${t.created}` : "";
}

export function chatKey(t) {
  // The chat's key for an agent: its session and program ("" for none).
  return t ? `${sessionOf(t)}:${t.app}` : "";
}

export function sessionKey(address) {
  const term = terminals().find(x => x.address === address);
  return term ? sessionOf({ address, created: term.created_ms ?? 0 }) : "";
}

export function chatOn() {
  // Whether agents' tabs may show as a chat (herdr-chat.chat: false, as harns's settings set it, keeps them on the terminal).
  return shared("herdr-chat.chat") !== false;
}

export function preferredView(key) {
  return !chatOn() || (shared(VIEWS_KEY) ?? {})[key] === "terminal" ? "terminal" : "chat";
}

function remember(key, mode) {
  if (!key) return;
  const views = { ...(shared(VIEWS_KEY) ?? {}) };
  delete views[key];
  views[key] = mode;
  const keys = Object.keys(views);
  for (const k of keys.slice(0, Math.max(0, keys.length - VIEWS_KEPT))) delete views[k];
  setShared(VIEWS_KEY, views);
}

export function switchTo(mode, key) {
  if (key) remember(key, mode);
  showView(mode);
}

export function shownView() {
  // Which of the Chat/Terminal stack's children shows ("chat", "terminal"), or null where the layout has no such stack.
  const find = (node) => node?.id === "chat-view" ? node : (node?.children ?? []).map(find).find(Boolean);
  const active = find(layout())?.active;
  return active === "terminal-panel" ? "terminal" : active === "chat-panel" ? "chat" : null;
}

export function adoptView(mode, key) {
  // A switch made outside the chat's own buttons (a key bound to layout.select, the sidebar): kept for the session as
  // theirs, and the mode follows, so switching to Chat focuses the box as the buttons do.
  if (key) remember(key, mode);
  setShared("herdr-chat.mode", mode);
  if (mode === "chat") setShared("herdr-chat.visit", Date.now());
}

export function showView(mode) {
  setShared("herdr-chat.mode", mode);
  if (mode === "chat") setShared("herdr-chat.visit", Date.now());
  run("layout.select", { stack: "chat-view", child: mode === "terminal" ? "terminal-panel" : "chat-panel" });
}
