// Talking to an agent's terminal through herdr-core: reading its screen, typing as the person, keys,
// and its own input box (input-box.py).
import { hc, exec, appHome } from "herdr";
import { onWindows, modFile, base64Utf8 } from "./platform.js";

/** The screen plus `lines` of history, or null when it can't be read. */
export async function readScreen(t, lines) {
  const r = await hc(["read", t.address, "--lines", String(lines)]);
  return r.code === 0 ? r.stdout : null;
}

/** The screen's end as prompts are judged on (what the question card and its checks compare). */
export async function readPrompt(t) {
  const screen = await readScreen(t, 26);
  return screen == null ? null : screen.trim().slice(-4000);
}

/**
 * Types `text` into the agent and presses Enter, as the person: from the agent's own machine and
 * without hc's terminal identity, so it isn't wrapped in <hc from="…">. `force` answers a blocked one.
 */
export function sendMessage(t, text, force) {
  const forced = force ? ["--force"] : [];
  if (t.remote) return exec("sh", ["-c", 'h=$(command -v hc || echo "$HOME/.local/bin/hc"); exec env -u HC_TERMINAL_ID -u HC_SCOPE "$h" send "$@"',
    "hc-send", ...forced, t.address.slice(t.address.indexOf("/") + 1), text], { on: t.machine });
  if (onWindows()) return exec("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    `${appHome()}\\mods\\herdr-chat\\send.ps1`, "-Address", t.address, "-Text64", base64Utf8(text), ...(force ? ["-Force"] : [])]);
  return exec("env", ["-u", "HC_TERMINAL_ID", "-u", "HC_SCOPE", "hc", "send", ...forced, t.address, text]);
}

/** Presses named keys in the terminal (up, down, enter, esc, …). */
export function pressKeys(t, keys) { return hc(["keys", t.address, ...keys]); }

/**
 * input-box.py: `read`, `set` (a JSON list of pastes) or `paste` on the agent's own input box.
 * Resolves with { ok, box (read and set: the box as read back, null for none), error }.
 */
export async function inputBox(command, t, ...args) {
  const r = await exec("python3", ["-I", modFile("input-box.py"), command, t.address, ...args]).catch(e => ({ code: 1, stderr: String(e) }));
  if (r.code !== 0) return { ok: false, box: null, error: (r.stderr || r.stdout || `input-box.py ${command} failed`).trim() };
  let box = null;
  try { box = r.stdout.trim() ? JSON.parse(r.stdout).box ?? null : null; } catch {}
  return { ok: true, box, error: "" };
}
