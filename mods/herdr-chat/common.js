// What the chat panel and the terminal header share.
import { run, setShared } from "herdr";

// Agents whose session logs read-session.ps1 can read, with the names people know them by.
export const SUPPORTED = { "claude-code": "Claude Code", codex: "Codex", pi: "Pi" };
export const ICONS = "mods/herdr-chat/icons";

// The layout holds the chat and the terminal in one stack ("chat-view"); this picks which shows.
// Without that stack in the layout, it does nothing.
export function switchTo(mode) {
  setShared("herdr-chat.mode", mode);
  if (mode === "chat") setShared("herdr-chat.visit", Date.now()); // the chat opens at the newest message
  run("layout.select", { stack: "chat-view", child: mode === "terminal" ? "terminal-panel" : "chat-panel" });
}
