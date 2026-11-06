import { readFileSync } from "node:fs";
import { parseChoices, parsePrompt, keysFor, looksLikePrompt } from "../mods/herdr-chat/prompts.js";

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
check("a list cut off inside a description is still a question", cutOff?.options.length === 2);
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

check("Claude: single choice past the rule", labels(read("claude-code", "claude-single")) === "Cat,Dog,Type something.,Chat about this");
check("Claude: the question and step tabs", read("claude-code", "claude-q1")?.question.at(-1) === "Pick a color" && /Submit/.test(read("claude-code", "claude-q1").tabs));
const claudeMulti = read("claude-code", "claude-q2-toggled");
check("Claude: multi-select with its Next row", claudeMulti?.multi && labels(claudeMulti) === "Cheese,Olives,Basil,Type something,Next,Chat about this");
check("Claude: what's checked", claudeMulti?.options.map(o => o.checked).join() === "false,true,false,false,,");
check("Claude: Next is reached by arrows past the options", keysFor("claude-code", claudeMulti, 4).join() === "down,down,down,enter");
check("Claude: the review step", labels(read("claude-code", "claude-review")) === "Submit answers,Cancel");
check("Claude: a permission prompt", labels(read("claude-code", "claude-perm")).endsWith(",No"));

const piMulti = read("pi", "pi-q2-toggled");
check("Pi: multi-select with short descriptions", piMulti?.multi && labels(piMulti) === "Cheese,Olives,Basil,Type something.,Next" && piMulti.options[1].checked === true);
check("Pi: descriptions stay with their options", read("pi", "pi-q2").options[0].desc[0] === "Add cheese.");
check("Pi: step tabs", /Submit/.test(read("pi", "pi-q1").tabs ?? ""));
check("Pi: the review step", labels(read("pi", "pi-review")) === "Submit answers,Cancel");

const oc = read("opencode", "opencode-q1");
check("OpenCode: a choice with no cursor mark", labels(oc) === "Red,Green,Blue,Type your own answer");
check("OpenCode: picks by number", keysFor("opencode", oc, 1).join() === "2");
const ocMulti = read("opencode", "opencode-q2-toggled");
check("OpenCode: multi-select gets a Next that tabs on", ocMulti?.multi && ocMulti.options.at(-1).next && keysFor("opencode", ocMulti, ocMulti.options.length - 1).join() === "tab");

check("Codex's questions still read", labels(parseChoices(screen("codex-q1")))?.startsWith("Red"));
check("Codex's permission prompt still reads", parseChoices(screen("codex-perm"))?.options.length === 3);
check("a footer with unreadable choices still looks like a prompt", read("claude-code", "claude-trust") === null && looksLikePrompt(screen("claude-trust")));
check("an agent's idle screen is no prompt", !looksLikePrompt("› Ask Codex to do anything\n\n  GPT · medium\n  ? for shortcuts"));

process.exit(failed ? 1 : 0);
