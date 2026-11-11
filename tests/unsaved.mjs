import { stage } from "./stage.mjs";
const s = stage();
const { unsavedMessage } = await s.load("model/unsaved.js");
const { harnessFor } = await s.load("harnesses/index.js");
let failed = 0;
const check = (got, want, what) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
const claude = harnessFor("claude-code");
const RULE = "─".repeat(60);
const QUESTION = [RULE, "←  ☐ Voice  ✔ Submit  →", "", "│ Which voice should it use?", "", "❯ 1. Mine", "  2. A matching one", RULE, "Enter to select"];
const screen = above => [...above, ...QUESTION].join("\n");

const message = ["● Running the probes now, one after the other.", "● Both probes are running. Meanwhile I'm noting that each user now owns", "  their voice, so a mismatch needs a rule.", ""];
check(unsavedMessage(claude, screen(message), ["Running the probes now, one after the other."]),
  { text: "Both probes are running. Meanwhile I'm noting that each user now owns their voice, so a mismatch needs a rule.", cut: false },
  "the message above the question, its wrapped lines joined");
check(unsavedMessage(claude, screen(message), ["Both probes are running. Meanwhile I'm noting that each user now owns their voice, so a mismatch needs a rule."]), null,
  "nothing once the log has it");
check(unsavedMessage(claude, screen(["● Two options:", "", "  - keep yours", "  - pick one that matches"]), []),
  { text: "Two options:\n\n- keep yours\n- pick one that matches", cut: false }, "paragraphs and list items keep their lines");
check(unsavedMessage(claude, screen(["  owns their voice, so a mismatch needs a rule."]), []),
  { text: "owns their voice, so a mismatch needs a rule.", cut: true }, "a message whose start is above the screen says so");
check(unsavedMessage(claude, screen(["● 2 background agents launched (↓ to manage)", "   ├ Probe P2", "   └ Probe P1"]), []), null, "a tool's block isn't a message");
check(unsavedMessage(claude, screen(["● Bash(docker ps --format '{{.Names}}')"]), []), null, "a tool call isn't a message");
check(unsavedMessage(claude, ["● Just a message, with no question below it."].join("\n"), []), null, "no question on screen: nothing");
check(unsavedMessage(harnessFor("codex"), screen(message), []), null, "a harness that doesn't say how it draws messages: nothing");
process.exit(failed ? 1 : 0);
