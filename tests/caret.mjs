import { lineMove, caretOf } from "../mods/herdr-chat/model/caret.js";
let failed = 0;
const check = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(`${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : `  got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); if (!ok) failed++; };
const t = "first line\nsecond, longer line\nend";
check(lineMove(t, 4, -1).at, 0, "↑ on the first line goes to the start");
check(lineMove(t, 35, 1).at, t.length, "↓ on the last line goes to the end");
check(lineMove(t, 4, 1).at, 15, "↓ keeps the column on the next line");
check(lineMove(t, 15, -1).at, 4, "↑ keeps the column on the line above");
check(lineMove(t, 28, 1), { at: 34, column: 17 }, "a longer column stops at the end of a shorter line, and remembers itself");
check(lineMove(t, 34, -1, 17).at, 28, "the remembered column comes back on a longer line");
check(lineMove("one line only", 6, -1).at, 0, "one line: ↑ to the start");
check(lineMove("one line only", 6, 1).at, 13, "one line: ↓ to the end");
check(lineMove("", 0, 1).at, 0, "empty box");
check(lineMove("ab\n\ncd", 1, 1).at, 3, "an empty line in between");
const emoji = "x😀y\nabc";
check(lineMove(emoji, 6, -1).at, 1, "↑ to a column before an emoji");
check(lineMove(emoji, 7, -1).at, 1, "never lands between an emoji's two halves (column 2 is inside it)");
const box = (text, start, end, failOnReplace = false) => {
  // A stand-in textarea: text with a selection, which replace() types over.
  let value = text, sel = { start, end };
  return {
    value: () => value,
    replace: s => { if (failOnReplace) { value = value.slice(0, sel.start) + s + value.slice(sel.end); throw new Error("boom"); } value = value.slice(0, sel.start) + s + value.slice(sel.end); sel = { start: sel.start + s.length, end: sel.start + s.length }; },
    set_value: v => { value = v; },
    set_selected_range: r => { sel = r; },
    sel: () => sel,
  };
};
let b = box("hello world", 6, 6);
check([caretOf(b), b.value(), b.sel()], [{ start: 6, end: 6 }, "hello world", { start: 6, end: 6 }], "reads the cursor, text and cursor unchanged");
b = box("hello world", 0, 5);
check([caretOf(b), b.value(), b.sel()], [{ start: 0, end: 5 }, "hello world", { start: 0, end: 5 }], "reads a selection, the selected text put back");
b = box("a\u2063b c", 4, 4);
check([caretOf(b).start, b.value()], [4, "a\u2063b c"], "a marker already in the text doesn't mislead it");
b = box("keep this", 0, 4, true);
let threw = false; try { caretOf(b); } catch { threw = true; }
check([threw, b.value()], [true, "keep this"], "if replace() throws midway, the text is still put back");
if (failed) process.exit(1);
