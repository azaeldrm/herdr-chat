// Calls every exported function and every mixin method of the chat mod with harmless arguments,
// under stand-ins for herdr and gpui-kit, and fails on a ReferenceError: a name used but never
// defined or imported (what moving code between modules tends to break; herdr-app check only
// loads the mod and draws it once). Other errors from the dummy arguments are expected.
//   node tests/sweep.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, copyFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const mod = join(dirname(fileURLToPath(import.meta.url)), "..", "mods", "herdr-chat");
const dir = mkdtempSync(join(tmpdir(), "herdr-chat-sweep-"));
const pkg = (name, source) => {
  mkdirSync(join(dir, "node_modules", name), { recursive: true });
  writeFileSync(join(dir, "node_modules", name, "package.json"), JSON.stringify({ name, type: "module", main: "index.js" }));
  writeFileSync(join(dir, "node_modules", name, "index.js"), source);
};
// an element: every builder method returns another; only .when runs its branch, as gpui-kit's does
const element = `export const el = () => new Proxy(function () {}, {
  get: (_t, k) => k === "then" ? undefined : k === "when" ? (c, f) => (c ? f(el()) : el()) : () => el(),
  apply: () => el(),
});`;
writeFileSync(join(dir, "element.js"), element);
pkg("gpui-kit", `import { el } from "../../element.js";
export const div = () => el(), svg = () => el(), image = () => el(); export class View {}
export const Background = { linear_gradient: () => ({}), stop: () => ({}) };`);
pkg("gpui-base", `import { el } from "../../element.js";
export const v_flex = () => el(), h_flex = () => el(), TextView = { markdown: () => el() };
export const TextareaState = { new: () => new Proxy({}, { get: (_t, k) => k === "value" ? () => "" : () => {} }) };
export const Textarea = { new: () => el() }, VirtualListScrollHandle = { new: () => ({}) }, v_virtual_list = () => el(), set_theme = () => {};`);
pkg("herdr", `export const appHome = () => "/home/u/.config/herdr-app";
export const exec = async () => ({ code: 0, stdout: '{"box": ""}', stderr: "" });
export const hc = async () => ({ code: 0, stdout: '{"path":"/x/placed.png"}' });
export const run = () => {}, shared = () => null, setShared = () => {}, terminals = () => [], settings = () => ({});
export const focused = () => ({ tab: "tb", space: "sp", terminal: "t1" });
export const agents = () => [{ address: "t1", tab: "tb", space: "sp", app: "claude-code", status: "working", pane: "p1" }];
export const panes = () => [], props = () => ({}), home = () => "/home/u", watchFolder = () => new Promise(() => {});
export const theme = () => new Proxy({}, { get: () => "#888888" });`);
const files = readdirSync(mod).filter(f => f.endsWith(".js"));
for (const f of files) copyFileSync(join(mod, f), join(dir, f));

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
for (const f of files) modules[f] = await import(pathToFileURL(join(dir, f)).href);
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
rmSync(dir, { recursive: true, force: true });
if (found.size) { console.error([...found].join("\n")); process.exit(1); }
console.log(`no undefined names: ${calls} calls across ${files.length} modules`);
