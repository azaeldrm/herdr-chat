// The agent's message drawn on screen above an open question, which its log doesn't have yet.
// Claude Code writes the message that ends in a question (its text, then the question) to its log only once the question
// is answered, so while the question is open the chat's log is a message behind the terminal. This reads that message
// off the screen the question card already reads, the way the harness draws it (`harness.screenMessage`).

const RULE = /^\s*─{10,}/;
const TOOL = /[⎿├└]/;
const LIST = /^(\s*[-*•]|\s*\d+[.)])\s/;

function words(text) {
  return text.toLowerCase().replace(/[^0-9a-z]+/g, " ").trim();
}

export function unsavedMessage(harness, screen, saved) {
  // The text of the message above the question on `screen`, or null: no question, nothing there, a tool call, `saved`
  // (the log's last agent texts) already has it, or its start is above the screen. While a question is open the terminal
  // can't be scrolled back, so the rest of a long message can't be read, and a message that starts midway would mislead;
  // the log has it whole once the question is answered.
  const look = harness?.screenMessage;
  if (!look || !screen) return null;
  const lines = screen.split("\n");
  const rule = lines.findIndex(l => RULE.test(l));
  if (rule <= 0) return null;
  let start = rule - 1;
  while (start >= 0 && !lines[start].startsWith(look.bullet)) start--;
  if (start < 0) return null;
  const block = lines.slice(start, rule);
  while (block.length && !block[block.length - 1].trim()) block.pop();
  if (!block.length || block.some(l => TOOL.test(l))) return null;
  const head = block[0].slice(look.bullet.length).replace(/^\s+/, "");
  if (look.tool.test(head)) return null;
  const body = [head, ...block.slice(1).map(l => l.startsWith(" ".repeat(look.indent)) ? l.slice(look.indent) : l.trimStart())];
  // The terminal wraps long lines: a line joins the one before it, unless it's blank, a list item, or follows a blank.
  let text = "";
  body.forEach((l, i) => {
    if (i === 0) text = l;
    else if (!l.trim()) text += "\n\n";
    else if (LIST.test(l) || text.endsWith("\n")) text += (text.endsWith("\n") ? "" : "\n") + l;
    else text += " " + l;
  });
  text = (look.label ? text.replace(look.label, "") : text).trim();
  const said = words(text);
  if (said.split(" ").length < 3 || (saved ?? []).some(s => words(s).includes(said))) return null;
  return text;
}
