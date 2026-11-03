// The reply box's cursor and ↑/↓. herdr's textarea can move its cursor (set_selected_range) but
// not say where it is, and it keeps ↑/↓ to itself, so the chat takes ↑/↓ in its own box (a key
// binding scoped to it, main.js) and moves the cursor by lines itself. No herdr imports: pure
// enough to test alone (tests/caret.mjs).

const MARK = "⁣"; // invisible separator

/**
 * Where the cursor (and selection) is: a marker typed at it with replace(), located, then the text
 * and the selection put back as they were. The text is put back even if a step throws (finally),
 * and the marker is found where the text first differs, so one already in the text can't mislead.
 * It all runs within one key event, so nothing else (drawing, the draft mirror, sending) sees it.
 */
export function caretOf(state) {
  const before = state.value();
  let at = 0, selected = 0;
  try {
    state.replace(MARK);
    const marked = state.value();
    while (at < before.length && before[at] === marked[at]) at++;
    selected = Math.max(0, before.length + 1 - marked.length);
  } finally {
    if (state.value() !== before) state.set_value(before);
  }
  state.set_selected_range({ start: at, end: at + selected });
  return { start: at, end: at + selected };
}

/** Never between the two halves of a character outside the BMP (an emoji): offsets are UTF-16. */
function onCharacter(text, at) {
  const c = text.charCodeAt(at);
  return at > 0 && at < text.length && c >= 0xdc00 && c <= 0xdfff ? at - 1 : at;
}

/**
 * Where ↑ (dir -1) or ↓ (dir +1) takes the cursor at `from` in `text`, by lines between line breaks:
 * ↑ on the first line goes to the start and ↓ on the last to the end; otherwise the same column on
 * the line above or below, or `goal` (the column a run of ↑/↓ started from) where that line is long
 * enough. Returns { at, column } (the column to keep for the next ↑/↓).
 */
export function lineMove(text, from, dir, goal = null) {
  const start = text.lastIndexOf("\n", from - 1) + 1;
  const column = goal ?? from - start;
  if (dir < 0) {
    if (start === 0) return { at: 0, column };
    const prevEnd = start - 1, prevStart = text.lastIndexOf("\n", prevEnd - 1) + 1;
    return { at: onCharacter(text, prevStart + Math.min(column, prevEnd - prevStart)), column };
  }
  const end = text.indexOf("\n", from);
  if (end < 0) return { at: text.length, column };
  const nextStart = end + 1, nextEnd = text.indexOf("\n", nextStart) < 0 ? text.length : text.indexOf("\n", nextStart);
  return { at: onCharacter(text, nextStart + Math.min(column, nextEnd - nextStart)), column };
}
