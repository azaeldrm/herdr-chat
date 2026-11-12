import { appHome, shared, run } from "herdr";
import { readFile } from "fs/promises";
import { onWindows } from "./platform.js";

export const PASSED_KEYS = { "alt-shift-up": "herdr_chat::PassAltShiftUp", "alt-shift-down": "herdr_chat::PassAltShiftDown" };
let keymap = {};

async function loadKeys() {
  // Reads keys.json into the cached keymap; a missing or broken file leaves it empty.
  try { keymap = JSON.parse(await readFile(onWindows() ? `${appHome()}\\keys.json` : `${appHome()}/keys.json`, "utf8")) ?? {}; }
  catch { keymap = {}; }
}
loadKeys();

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
