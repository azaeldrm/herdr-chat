// A tab opened to start an agent (the new-agent menu: tab.new with the agent as argv) runs a shell first, and herdr
// reports it as an agent only once the agent itself starts, a second or two later. Until then the chat has no agent to
// show, so it would flip to the terminal: a blank shell, then the agent's start screen, then the chat. launching() names
// the agent such a terminal is starting, so the chat can open on that agent's welcome at once.
import { focused, terminals, agents } from "herdr";
import { HARNESSES } from "./harnesses/index.js";

// How long after a terminal first appears it counts as starting; past this, one still not reporting gets its terminal.
const LAUNCH_MS = 20000;

// When this chat first saw each terminal: 0 for those already there when it started (restored, not just opened).
const seen = new Map();
let primed = false;

export function noticeTerminals() {
  // Records terminals as they appear (the chat's tick, before it picks the view), and forgets the ones gone.
  const now = Date.now(), live = new Set();
  for (const x of terminals()) {
    live.add(x.address);
    if (!seen.has(x.address)) seen.set(x.address, primed ? now : 0);
  }
  primed = true;
  for (const a of seen.keys()) if (!live.has(a)) seen.delete(a);
}

export function justOpened(address) {
  // Whether this terminal appeared within LAUNCH_MS, while the chat was running.
  if (!primed) return false;
  if (!seen.has(address)) seen.set(address, Date.now());
  const at = seen.get(address);
  return at > 0 && Date.now() - at < LAUNCH_MS;
}

// When this chat first found the focused terminal not listed yet, by address (one at a time is all it needs).
let unlistedSince = null;

export function unlisted() {
  // Whether the focused terminal is one herdr hasn't listed yet: a tab opened a moment ago, which a tick or two lists with
  // its launch command. Not for long, in case one never is.
  const address = focused()?.terminal;
  if (!address || terminals().some(x => x.address === address)) { unlistedSince = null; return false; }
  if (unlistedSince?.address !== address) unlistedSince = { address, at: Date.now() };
  return Date.now() - unlistedSince.at < 2000;
}

export function harnessIn(argv) {
  // The supported agent a launch command starts (`powershell … "& 'claude'"`, `sh -c … codex --no-daemon`), or null.
  const words = new Set((argv ?? []).join(" ").split(/[\s'"&;|()\/\\]+/).map(w => w.replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase()));
  return Object.values(HARNESSES).find(h => h.command && words.has(h.command)) ?? null;
}

export function launching() {
  // The agent the focused terminal was just opened to start and hasn't reported yet: { address, label, title, program,
  // pane }, what the header, the welcome and the reply box's hint show of target()'s agent; null otherwise.
  const f = focused();
  if (!f?.terminal) return null;
  const term = terminals().find(x => x.address === f.terminal);
  if (!term || term.state !== "live" || term.report?.app || !justOpened(term.address)) return null;
  const harness = harnessIn(term.argv);
  if (!harness) return null;
  // Its icon as herdr draws that agent elsewhere (another of its kind running), so the welcome keeps it when it reports.
  const program = agents().find(a => a.app === harness.id)?.program ?? null;
  return { address: term.address, label: harness.label, title: harness.label, program, pane: f.pane };
}
