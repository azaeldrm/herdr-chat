import assert from "node:assert/strict";
import { withCopyRows, splitCode } from "../mods/herdr-chat/model/transcript.js";

const u = text => ({ kind: "message", role: "user", text });
const a = text => ({ kind: "message", role: "assistant", text });
const tools = { kind: "tools", calls: [] };

const rows = withCopyRows([u("hi"), a("one"), tools, a("two"), u("again"), a("three")], false);
assert.deepEqual(rows.filter(r => r.kind === "copy").map(r => r.text), ["one\n\ntwo", "three"]);
assert.equal(rows[4].kind, "copy");
assert.equal(rows.at(-1).kind, "copy");

const live = withCopyRows([u("hi"), a("one"), u("again"), a("partial")], true);
assert.deepEqual(live.filter(r => r.kind === "copy").map(r => r.text), ["one"]);

assert.deepEqual(withCopyRows([u("hi"), tools], false).filter(r => r.kind === "copy"), []);

const parts = splitCode("before\n```js\nlet x = 1;\n```\nafter");
assert.deepEqual(parts, [
  { kind: "text", text: "before" },
  { kind: "code", lang: "js", text: "let x = 1;" },
  { kind: "text", text: "after" },
]);
assert.equal(splitCode("plain"), null);
console.log("copy rows: ok");
