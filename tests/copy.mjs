import assert from "node:assert/strict";
import { withCopyRows, splitCode } from "../mods/herdr-chat/model/transcript.js";

const u = text => ({ kind: "message", role: "user", text });
const a = text => ({ kind: "message", role: "assistant", text });
const tools = { kind: "tools", calls: [] };

const answers = rs => rs.filter(r => r.kind === "copy" && !r.prompt).map(r => r.text);
const prompts = rs => rs.filter(r => r.kind === "copy" && r.prompt).map(r => r.text);
const rows = withCopyRows([u("hi"), a("one"), tools, a("two"), u("again"), a("three")], false);
assert.deepEqual(answers(rows), ["one\n\ntwo", "three"]);
assert.deepEqual(prompts(rows), ["hi", "again"], "each of the person's messages gets its own copy row");
assert.deepEqual(rows.slice(0, 2).map(r => [r.kind, r.prompt ?? false]), [["message", false], ["copy", true]], "right after the message");
assert.equal(rows[5].kind, "copy");
assert.equal(rows.at(-1).kind, "copy");

const live = withCopyRows([u("hi"), a("one"), u("again"), a("partial")], true);
assert.deepEqual(answers(live), ["one"]);

assert.deepEqual(answers(withCopyRows([u("hi"), tools], false)), []);
assert.deepEqual(prompts(withCopyRows([u("  "), tools], false)), [], "an empty message (an image alone) gets none");

const parts = splitCode("before\n```js\nlet x = 1;\n```\nafter");
assert.deepEqual(parts, [
  { kind: "text", text: "before" },
  { kind: "code", lang: "js", text: "let x = 1;" },
  { kind: "text", text: "after" },
]);
assert.equal(splitCode("plain"), null);
console.log("copy rows: ok");
