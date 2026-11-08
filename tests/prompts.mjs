import { readFileSync } from "node:fs";
import { parseChoices, parsePrompt, keysFor, looksLikePrompt, typedAnswer } from "../mods/herdr-chat/prompts.js";
import claudeCode from "../mods/herdr-chat/harnesses/claude-code.js";
import codex from "../mods/herdr-chat/harnesses/codex.js";
import pi from "../mods/herdr-chat/harnesses/pi.js";
const opencode = { prompt: { byNumber: true } };

let failed = false;
const check = (name, ok) => { console.log(`${ok ? "ok" : "FAIL"}  ${name}`); if (!ok) failed = true; };

const footer = " Enter to select · ↑/↓ to navigate · n to add notes · Tab to switch questions · Esc to cancel …";
const rule = "─".repeat(95);

const cutOff = parseChoices([
  rule,
  " ←  ■ Version   □ Ships from   □ Acceptance   □ Offer scope   ✓ Submit  →",
  "",
  "",
  " What exactly should count as ships_from being Amazon?",
  "",
  "❯ 1. Exact Amazon.com (Recommended)",
  "     Only normalize + exact-match ships_from == 'Amazon.com'. Captured AOD fixtures use this",
  "     value; no fuzzy containment.",
  "  2. Accepted identity set",
  "     Accept ships_from when it is Amazon.com, Amazon Resale, or Amazon Warehouse, matching the",
  "↓",
  rule,
  "",
  footer,
].join("\n"));
check("a list cut off inside a description is still a question", cutOff?.options.length === 3 && cutOff.options[2].hidden && cutOff.options[2].input === "text");
check("its descriptions stay with their options", cutOff?.options[1].desc.length === 1 && cutOff?.options[0].desc.length === 2);
check("the first one is selected", cutOff?.options[0].selected === true && cutOff?.options[1].selected === false);
check("more choices are noted", cutOff?.more === true);
check("the question is read", cutOff?.question.at(-1) === "What exactly should count as ships_from being Amazon?");

const whole = parseChoices([
  " Pick one",
  "",
  "❯ 1. First",
  "     About the first",
  "  2. Second",
  "     About the second",
  "",
  footer,
].join("\n"));
check("a whole list ending on a description is read", whole?.options.map(o => o.label).join() === "First,Second" && whole?.more === false);

const none = parseChoices(["     some indented text", "     more of it", "", footer].join("\n"));
check("indented text alone is no question", none === null);

const screen = name => readFileSync(new URL(`fixtures/prompts/${name}.txt`, import.meta.url), "utf8").trim();
const read = (app, name) => parsePrompt(app, screen(name));
const labels = p => p?.options.map(o => o.label).join();

check("Claude: single choice past the rule", labels(read(claudeCode, "claude-single")) === "Cat,Dog,Type something.,Chat about this");
check("Claude: the question and step tabs", read(claudeCode, "claude-q1")?.question.at(-1) === "Pick a color" && /Submit/.test(read(claudeCode, "claude-q1").tabs));
const claudeMulti = read(claudeCode, "claude-q2-toggled");
check("Claude: multi-select with its Next row", claudeMulti?.multi && labels(claudeMulti) === "Cheese,Olives,Basil,Type something,Next,Chat about this");
check("Claude: what's checked", claudeMulti?.options.map(o => o.checked).join() === "false,true,false,false,,");
check("Claude: Next is reached by arrows past the options", keysFor(claudeCode, claudeMulti, 4).join() === "down,down,down,enter");
check("Claude: the review step", labels(read(claudeCode, "claude-review")) === "Submit answers,Cancel");
check("Claude: a permission prompt", labels(read(claudeCode, "claude-perm")).endsWith(",No"));
check("Claude: a permission prompt drops its tip", !read(claudeCode, "claude-perm").question.some(l => l.startsWith("Tip:")));

const claudeOne = read(claudeCode, "claude-q1");
check("Claude: steps with what's answered", claudeOne.steps.map(s => s.label).join() === "Color,Toppings,Size,Submit" && claudeOne.steps.every(s => !s.done));
check("Claude: its text rows are inputs", claudeOne.options.map(o => o.input ?? "").join() === ",,,text,chat");
check("Claude: typing goes to the row with arrows only", typedAnswer(claudeCode, claudeOne, 3).before.join() === "down,down,down");
check("Claude: chatting leaves the question first", typedAnswer(claudeCode, claudeOne, 4).before.join() === "down,down,down,down,enter");
check("Claude: a multi-select's text row stays an input", claudeMulti.options[3].input === "text" && claudeMulti.options[3].typed === "");
const typedRow = parsePrompt(claudeCode, screen("claude-q2-toggled").replace("[ ] Type something", "[✔] anchovy"));
check("Claude: typed text stays in its input row", typedRow.options[3].input === "text" && typedRow.options[3].typed === "anchovy" && typedRow.options[3].checked);
check("Claude: typing doesn't change which question this is", typedRow.sig === claudeMulti.sig);

const submit = read(claudeCode, "claude-submit-page");
check("Claude: the review keeps its steps", submit.steps.length === 4 && submit.review.warning === "You have not answered all questions");
const answered = read(claudeCode, "claude-review-answered");
check("Claude: a review with answers keeps its steps and lists them", answered.steps.length === 4 && answered.review.answers.at(-1).answer === "Small" && answered.review.answers.length === 3);
const noted = parsePrompt(claudeCode, `${screen("claude-review-answered")}\n[hc] only its screen: it is blocked; history is not scrolled in this state`);
check("Claude: hc's note under a screen doesn't hide a review", noted?.steps.length === 4 && noted.options.length === 2);
const piSubmit = read(pi, "pi-submit-page");
check("Pi: the review keeps its steps past the rule", piSubmit.steps.length === 4 && piSubmit.review.warning.startsWith("Answer remaining"));
check("Pi: the review's title stands as the question", piSubmit.question.join() === "Review your answers");
const piReview = read(pi, "pi-review");
check("Pi: the review lists the answers", piReview.review.answers.map(a => `${a.question}=${a.answer}`).join() === "Color=Green,Toppings=Olives,Size=Small");

const piCut = parsePrompt(pi, screen("pi-q2").replace(/\n[^\n]*Type something\.[^\n]*\n[^\n]*Next[^\n]*\n/, "\n↓\n"));
check("Pi: a cut-off multi-select still offers its text row and Next", piCut.more && piCut.options.at(-2).input === "text" && piCut.options.at(-2).hidden && piCut.options.at(-1).next);
check("Pi: Next past the cut-off moves on with the arrow", keysFor(pi, piCut, piCut.options.length - 1).join() === "right");
check("Pi: scrolling doesn't change which question this is", piCut.sig === read(pi, "pi-q2").sig);

const narrow = parsePrompt(pi, ["────────────", " ←  □ Color   ■ Toppings", "", " Pick a size", "", "❯ 1. Small", "  2. Large", "────────────", " Enter to select · ↑/↓ to …"].join("\n"));
check("Pi: a step row cut off by a narrow window keeps its steps", narrow.steps.map(s => s.label).join() === "Color,Toppings" && narrow.steps[1].done);

const wrapped = parsePrompt(claudeCode, [
  "─".repeat(40),
  "←  ☒ Scope  ☐ Extras  ✔ Submit  →",
  "",
  "│ Which related fixes should this effort include? Both were planned, and neither",
  "│ is needed for it to work. The other one matters too, and I found no fix for",
  "│ that in the code.",
  "",
  "❯ 1. [ ] Cleanup (Recommended)",
  "         Remove the unused fields, as the story decided. Small, but it changes the",
  "         working client and four test fakes.",
  "  2. [ ] Other fix",
  "         Normalize uploads first.",
  "  3. [ ] Type something",
  "     Next",
  "─".repeat(40),
  "  4. Chat about this",
  "",
  "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
].join("\n"));
check("Claude: a wrapped question stays one question", wrapped.question.length === 1 && wrapped.question[0].startsWith("Which related") && wrapped.question[0].endsWith("in the code."));
check("Claude: a wrapped description stays with its option", wrapped.options[0].desc.length === 2);
const perm = read(claudeCode, "claude-perm");
check("Claude: a permission prompt keeps details apart from its question", perm.question.at(-1) === "Do you want to proceed?" && perm.question.some(l => l.startsWith("touch")));

const piSingleCut = parsePrompt(pi, screen("pi-q1").replace(/\n[^\n]*Type something\.[^\n]*\n/, "\n↓\n"));
check("Pi: a cut-off single choice still offers its text row", piSingleCut.more && piSingleCut.options.at(-1).input === "text" && piSingleCut.options.at(-1).hidden && piSingleCut.options.at(-1).checked === undefined);

const piMulti = read(pi, "pi-q2-toggled");
check("Pi: multi-select with short descriptions", piMulti?.multi && labels(piMulti) === "Cheese,Olives,Basil,Type something.,Next" && piMulti.options[1].checked === true);
check("Pi: descriptions stay with their options", read(pi, "pi-q2").options[0].desc[0] === "Add cheese.");
check("Pi: step tabs", /Submit/.test(read(pi, "pi-q1").tabs ?? ""));
check("Pi: the review step", labels(read(pi, "pi-review")) === "Submit answers,Cancel");

const oc = read(opencode, "opencode-q1");
check("OpenCode: a choice with no cursor mark", labels(oc) === "Red,Green,Blue,Type your own answer");
check("OpenCode: picks by number", keysFor(opencode, oc, 1).join() === "2");
const ocMulti = read(opencode, "opencode-q2-toggled");
check("OpenCode: multi-select gets a Next that tabs on", ocMulti?.multi && ocMulti.options.at(-1).next && keysFor(opencode, ocMulti, ocMulti.options.length - 1).join() === "tab");

const codexQ = read(codex, "codex-q2");
check("Codex: label and description in one row are split", labels(codexQ) === "Cheese,Olives,Basil,None of the above" && codexQ.options[0].desc[0] === "Add cheese.");
check("Codex: the step shows apart from the question", /^Question 2\/3/.test(codexQ.tabs) && codexQ.question[0].startsWith("Pick toppings"));
check("Codex: picks with arrows and Enter", keysFor(codex, read(codex, "codex-q1"), 2).join() === "down,down,enter");
check("Codex: typing goes into the notes", typedAnswer(codex, codexQ, 3).before.at(-1) === "tab" && codexQ.options[3].input === "text");
check("Codex: the step row is one step", codexQ.steps.length === 1 && /^Question 2\/3/.test(codexQ.steps[0].label));
const codexPerm = read(codex, "codex-perm");
check("Codex: a permission prompt keeps its command", codexPerm?.options.length === 3 && codexPerm.question.some(l => l.includes("touch perm-test.txt")));
check("a footer with unreadable choices still looks like a prompt", read(claudeCode, "claude-trust") === null && looksLikePrompt(screen("claude-trust")));
check("an agent's idle screen is no prompt", !looksLikePrompt("› Ask Codex to do anything\n\n  GPT · medium\n  ? for shortcuts"));

process.exit(failed ? 1 : 0);
