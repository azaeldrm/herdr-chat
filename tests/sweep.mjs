// Calls every exported function and every mixin method of the chat mod with harmless arguments,
// under stand-ins for herdr and gpui-kit, and fails on a ReferenceError: a name used but never
// defined or imported (what moving code between modules tends to break; herdr-app check only
// loads the mod and draws it once). Other errors from the dummy arguments are expected.
//   node tests/sweep.mjs
import { readdirSync } from "fs";
import { stage, MOD } from "./stage.mjs";

const staged = stage();
const files = readdirSync(MOD).filter(f => f.endsWith(".js"));

const found = new Set();
const late = e => { if (e instanceof ReferenceError) found.add(`(later) ${e.message}`); };
process.on("unhandledRejection", late); process.on("uncaughtException", late);
const t = new Proxy({}, { get: () => "#888888" });
const target = { address: "t1", created: 1, app: "claude-code", label: "Claude Code", status: "working", pane: "p1", remote: false, machine: null };
const cx = new Proxy({}, { get: (_t, k) => k === "spawn" ? f => f(cx) : k === "timer" ? { every: () => {}, after: () => {} } : k === "read_from_clipboard" ? () => undefined : () => {} });
const argSets = [[t, target], [target, "t1:1", cx], [cx], ["x", target], [[{ file: "/a.png", name: "a" }], cx], []];
let calls = 0;
const sweep = async (label, fn, self) => {
  for (const args of argSets) {
    calls++;
    try {
      const r = fn.apply(self, args);
      if (r && typeof r.then === "function") await Promise.race([r, new Promise(res => setTimeout(res, 50))]);
    } catch (e) { if (e instanceof ReferenceError) found.add(`${label}: ${e.message}`); }
  }
};
const modules = {};
for (const f of files) modules[f] = await staged.load(f);
const mixins = Object.values(modules).flatMap(m => Object.entries(m).filter(([k, v]) => /Methods$/.test(k) && v && typeof v === "object").map(([, v]) => v));
for (const [f, m] of Object.entries(modules)) {
  for (const [name, value] of Object.entries(m)) {
    if (typeof value === "function" && !/^[A-Z]/.test(name)) await sweep(`${f} ${name}`, value);
    if (/Methods$/.test(name)) for (const [method, fn] of Object.entries(value)) {
      const self = Object.assign({
        key: "t1:1:claude-code", attachments: [{ file: "/a.png", name: "a", rel: "cache/a.png" }], drafts: new Map(),
        mirror: null, mirrorChain: Promise.resolve(), choices: null, screen: "x", open: {}, width: 900, lastMode: "chat",
        lastModeSession: "t1:1", input: { value: () => "hi", set_value: () => {}, focus: () => {} },
      }, ...mixins);
      await sweep(`${f} ${name}.${method}`, fn, self);
    }
  }
}
await new Promise(r => setTimeout(r, 300));
staged.cleanup();
if (found.size) { console.error([...found].join("\n")); process.exit(1); }
console.log(`no undefined names: ${calls} calls across ${files.length} modules`);
