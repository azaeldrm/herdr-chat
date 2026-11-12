import { appHome, shared, run } from "herdr";
import { readFile } from "fs/promises";
import { onWindows } from "./platform.js";

const CONTEXT = "HerdrChatReply > Input";
const LAYOUT_KEYS = { "alt-shift-up": "herdr_chat::PassAltShiftUp", "alt-shift-down": "herdr_chat::PassAltShiftDown" };
const COMPOSER_KEYS = [
  { keystroke: "up", action: "herdr_chat::LineUp" },
  { keystroke: "down", action: "herdr_chat::LineDown" },
  { keystroke: "escape", action: "herdr_chat::Stop" },
  ...Object.entries(LAYOUT_KEYS).map(([keystroke, action]) => ({ keystroke, action })),
].map(key => ({ ...key, context: CONTEXT }));

let keymap = {}, keymapText = null, keymapChanged = false;

async function readKeymap() {
  // Reads keys.json into the keymap, noting when its text changed since the last read.
  let text;
  try { text = await readFile(onWindows() ? `${appHome()}\\keys.json` : `${appHome()}/keys.json`, "utf8"); }
  catch { text = ""; }
  if (keymapText !== null && text !== keymapText) keymapChanged = true;
  keymapText = text;
  try { keymap = JSON.parse(text) ?? {}; } catch { keymap = {}; }
}
readKeymap();

export function bindComposerKeys(cx) {
  // Binds the composer's keys, and binds them again each time keys.json changes, as Herdr then installs its keymap anew.
  if (globalThis.herdrChatComposerKeys) return;
  globalThis.herdrChatComposerKeys = true;
  cx.bind_keys(COMPOSER_KEYS);
  cx.timer.every(1000, cx => {
    if (keymapChanged) { keymapChanged = false; cx.bind_keys(COMPOSER_KEYS); }
    readKeymap();
  });
}

function bound(keystroke) {
  // What keys.json binds this chord to for the shown layout, else globally.
  return keymap[`layout:${shared("layout")}`]?.[keystroke] ?? keymap.global?.[keystroke];
}

export function passKey(keystroke) {
  // Runs keys.json's binding for a layout key the composer's text input would otherwise take; true when it ran one.
  if (!(keystroke in LAYOUT_KEYS)) return false;
  const action = bound(keystroke);
  if (typeof action === "string" && !action.includes(":") && action !== "terminal") { run(action); return true; }
  if (action && typeof action === "object" && action.command) { run(action.command, action.args ?? {}); return true; }
  return false;
}
