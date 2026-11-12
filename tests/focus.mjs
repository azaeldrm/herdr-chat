// When the chat's reply box takes the keyboard: Chat switched to from Terminal, or Chat showing another agent.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { stage } from "./stage.mjs";
const s = stage();
const herdr = join(s.dir, "node_modules", "herdr", "index.js");
writeFileSync(herdr, readFileSync(herdr, "utf8")
  .replace("shared = () => null, setShared = () => {}", "shared = k => globalThis.store[k] ?? null, setShared = (k, v) => { globalThis.store[k] = v; }")
  .replace("terminals = () => []", "terminals = () => globalThis.terms")
  .replace(/export const focused = .*\n/, "export const focused = () => globalThis.focus;\n")
  .replace(/export const agents = .*\n/, "export const agents = () => globalThis.agentList;\n"));
globalThis.store = {};
const { Composer } = await s.load("components/composer.js");
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};

// Two Claude Code agents, one per tab; `show` focuses one tab in one view, as herdr and the stack would.
globalThis.terms = [{ address: "t1", created_ms: 1 }, { address: "t2", created_ms: 2 }];
globalThis.agentList = [
  { address: "t1", tab: "tb1", space: "sp", app: "claude-code", status: "idle", pane: "p1" },
  { address: "t2", tab: "tb2", space: "sp", app: "claude-code", status: "idle", pane: "p2" },
];
let focusedTimes = 0;
const self = { lastMode: undefined, lastModeSession: undefined, host: { sending: false, card: { choices: null } },
  input: { focus: () => { focusedTimes++; } }, pushDraft: () => {}, pullDraft: () => {} };
const tick = () => Composer.prototype.mirrorOnSwitch.call(self, {});
const show = (tab, mode) => { globalThis.focus = { space: "sp", tab, terminal: tab === "tb1" ? "t1" : "t2" }; globalThis.store["herdr-chat.mode"] = mode; };
const focusesOn = (tab, mode) => { show(tab, mode); const before = focusedTimes; tick(); return focusedTimes > before; };

focusesOn("tb1", "chat");
check("staying on the same agent in Chat leaves the keyboard where it is", focusesOn("tb1", "chat"), false);
check("another tab's agent, still in Chat, takes the box", focusesOn("tb2", "chat"), true);
check("switching to Terminal doesn't", focusesOn("tb2", "terminal"), false);
check("another tab's agent while in Terminal doesn't", focusesOn("tb1", "terminal"), false);
check("Terminal to Chat takes the box", focusesOn("tb1", "chat"), true);

s.cleanup();
process.exit(failed ? 1 : 0);
