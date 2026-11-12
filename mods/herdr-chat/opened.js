// When each terminal appeared, as this chat saw it: an agent in a terminal opened moments ago has no conversation yet,
// so the chat can show its welcome at once instead of loading one that isn't there.
import { terminals } from "herdr";

// How long after a terminal appears its agent counts as just started.
const OPENED_MS = 20000;

// When this chat first saw each terminal: 0 for those already there when it started (restored, not just opened).
const seen = new Map();
let primed = false;

export function noticeTerminals() {
  // Records terminals as they appear (the chat's tick), and forgets the ones gone.
  const now = Date.now(), live = new Set();
  for (const x of terminals()) {
    live.add(x.address);
    if (!seen.has(x.address)) seen.set(x.address, primed ? now : 0);
  }
  primed = true;
  for (const a of seen.keys()) if (!live.has(a)) seen.delete(a);
}

export function justOpened(address) {
  // Whether this terminal appeared within OPENED_MS, while the chat was running.
  if (!primed) return false;
  if (!seen.has(address)) seen.set(address, Date.now());
  const at = seen.get(address);
  return at > 0 && Date.now() - at < OPENED_MS;
}
