import { appHome, shared, run } from "herdr";
import { readFile } from "fs/promises";
import { onWindows } from "./platform.js";

export const PASSED_KEYS = { "alt-shift-up": "herdr_chat::PassAltShiftUp", "alt-shift-down": "herdr_chat::PassAltShiftDown" };
const REPLY = "HerdrChatReply > Input";
let keymap = {}, keysText = null;

async function loadKeys() {
  // Reads keys.json into the cached keymap and its text; a missing or broken file leaves the keymap empty.
  try { keysText = await readFile(onWindows() ? `${appHome()}\\keys.json` : `${appHome()}/keys.json`, "utf8"); }
  catch { keysText = ""; }
  try { keymap = JSON.parse(keysText) ?? {}; } catch { keymap = {}; }
}
loadKeys();

function replyKeys() {
  // The reply box's own keys: line moves, Stop, and the layout keys it passes on.
  return [
    { keystroke: "up", action: "herdr_chat::LineUp", context: REPLY },
    { keystroke: "down", action: "herdr_chat::LineDown", context: REPLY },
    { keystroke: "escape", action: "herdr_chat::Stop", context: REPLY },
    ...Object.entries(PASSED_KEYS).map(([keystroke, action]) => ({ keystroke, action, context: REPLY })),
  ];
}

export function keepReplyKeys(cx) {
  // Binds the reply box's keys, and binds them again whenever keys.json changes: Herdr's reload of it drops every key a
  // mod bound. The tick after a change binds them once more, in case Herdr's reload landed after this one read the file.
  if (globalThis.herdrChatReplyKeys) return;
  globalThis.herdrChatReplyKeys = true;
  cx.bind_keys(replyKeys());
  let boundText = null, again = false;
  cx.timer.every(1000, cx => {
    if (again) { cx.bind_keys(replyKeys()); again = false; }
    if (keysText !== null && boundText === null) boundText = keysText;
    else if (keysText !== null && keysText !== boundText) { cx.bind_keys(replyKeys()); boundText = keysText; again = true; }
    loadKeys();
  });
}

function bound(keystroke) {
  // What keys.json binds this chord to for the shown layout, else globally.
  return keymap[`layout:${shared("layout")}`]?.[keystroke] ?? keymap.global?.[keystroke];
}

export function passKey(keystroke) {
  // Runs keys.json's binding for a chord the reply box's text input would otherwise take; true when it ran one.
  if (!(keystroke in PASSED_KEYS)) return false;
  const action = bound(keystroke);
  loadKeys();
  if (typeof action === "string" && !action.includes(":") && action !== "terminal") { run(action); return true; }
  if (action && typeof action === "object" && action.command) { run(action.command, action.args ?? {}); return true; }
  return false;
}
