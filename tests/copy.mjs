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

// A turn's numbers: ticks become a "stats" row at the turn's end, which lands on the response's copy row.
const { TurnClock } = await import("../mods/herdr-chat/model/session.js");
const clock = new TurnClock(), rowsOut = [];
for (const e of [{ at: 100, p: 1 }, { at: 102, id: "a", out: 10 }, { at: 104, id: "a", out: 40 }, { at: 110 }, { at: 111, id: "b", out: 20 }, { at: 113, id: "b", out: 20 }]) clock.tick(e);
clock.end(rowsOut);
assert.deepEqual(rowsOut, [{ kind: "stats", text: "", secs: 13, out: 60, tps: 60 / 7 }], "time from the prompt; tokens per reply once; rate over the model's time (4s + 3s)");
const withStats = withCopyRows([u("hi"), a("one"), rowsOut[0], u("again")], false);
assert.deepEqual(withStats.find(r => r.kind === "copy" && !r.prompt).stats, { secs: 13, out: 60, tps: 60 / 7 });
assert.equal(withStats.some(r => r.kind === "stats"), false, "the stats row itself isn't drawn");
const none = []; new TurnClock().end(none); assert.deepEqual(none, [], "no replies, no numbers");
const timed = new TurnClock(), timedOut = [];
for (const e of [{ at: 5, p: 1 }, { at: 6 }, { at: 9, id: "r", out: 0 }]) timed.tick(e);
timed.end(timedOut);
assert.deepEqual(timedOut, [{ kind: "stats", text: "", secs: 4, out: 0, tps: null }], "a harness without token counts still gets its time");
console.log("turn numbers: ok");
