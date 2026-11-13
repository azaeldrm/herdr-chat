import { codexThread, daemonChoices, daemonReply } from "../mods/herdr-chat/harnesses/codex-daemon.js";

let failed = false;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "ok" : "FAIL"}  ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed = true;
};

const ID = "01a1d57f-fed7-70b0-8800-0ba8ed6091cf";
check("a log's name gives its conversation", codexThread(`/h/.codex/sessions/2026/11/13/rollout-2026-11-13T09-48-16-${ID}.jsonl`), ID);
check("another file gives none", codexThread("/h/.claude/projects/-w/abc.jsonl"), "");

const command = {
  id: 2, method: "item/commandExecution/requestApproval",
  params: {
    threadId: ID, itemId: "exec-1", startedAtMs: 1, reason: "The sandbox permits only reads.",
    command: "/usr/bin/bash -lc 'touch marker.txt'", cwd: "/work",
    availableDecisions: ["accept", { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["touch", "marker.txt"] } }, "cancel"],
  },
};
const c = daemonChoices(command);
check("a command approval shows the command as typed, and where", c.question.slice(0, 2), ["$ touch marker.txt", "in /work"]);
check("its question is Codex's own reason", c.question.at(-1), "The sandbox permits only reads.");
check("without a reason it asks plainly", daemonChoices({ ...command, params: { ...command.params, reason: null } }).question.at(-1), "Allow Codex to run this command?");
check("its rows are the decisions Codex offers, in its words", c.options.map(o => o.label), ["Yes, proceed", "Yes, and don't ask again for commands that start with `touch marker.txt`", "No, and tell Codex what to do differently"]);
check("the first row starts selected, as in the terminal", c.options.map(o => o.selected), [true, false, false]);
check("it's answered through the daemon, by its item", c.daemon, { method: command.method, item: "exec-1" });
check("picking a row sends its decision", daemonReply(c, 1), { result: { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["touch", "marker.txt"] } } } });
check("its signature names the item, so a new request is a new card", JSON.parse(c.sig).includes("exec-1"), true);

const files = { id: 3, method: "item/fileChange/requestApproval", params: { threadId: ID, itemId: "patch-1", startedAtMs: 2 } };
const f = daemonChoices(files);
check("a file change offers Codex's four decisions", f.options.map(o => o.decision), ["accept", "acceptForSession", "decline", "cancel"]);
check("it asks about the files", f.question, ["Allow Codex to make these file changes?"]);

const input = {
  id: 4, method: "item/tool/requestUserInput",
  params: {
    threadId: ID, itemId: "ask-1", turnId: "t", isBlocking: true,
    questions: [
      { id: "color", header: "Color", question: "Which color?", options: [{ label: "Red", description: "warm" }, { label: "Blue", description: "" }] },
      { id: "name", header: "Name", question: "What name?", isOther: true, options: null },
    ],
  },
};
const q1 = daemonChoices(input);
check("a question with several parts shows them as steps", q1.steps, [{ label: "Color", done: false }, { label: "Name", done: false }]);
check("its first part shows its options and descriptions", q1.options.map(o => [o.label, o.desc]), [["Red", ["warm"]], ["Blue", []]]);
const next = daemonReply(q1, 1);
check("answering a part moves to the next, keeping the answer", next, { step: 1, answers: { color: { answers: ["Blue"] } } });
const q2 = daemonChoices(input, next.step, next.answers);
check("a part with no options takes typed text", q2.options.map(o => o.input), ["text"]);
check("the next part is a new card", q2.sig !== q1.sig, true);
check("an empty typed answer sends nothing", daemonReply(q2, 0, "  "), null);
check("the last part sends every answer", daemonReply(q2, 0, "Ada"), { result: { answers: { color: { answers: ["Blue"] }, name: { answers: ["Ada"] } } } });

check("a secret question is left to the terminal", daemonChoices({ ...input, params: { ...input.params, questions: [{ id: "k", header: "Key", question: "API key?", isSecret: true }] } }), null);
check("a request the chat doesn't know is left to the terminal", daemonChoices({ id: 5, method: "mcpServer/elicitation/request", params: { threadId: ID, itemId: "m" } }), null);
check("a command approval with one decision is left to the terminal", daemonChoices({ ...command, params: { ...command.params, availableDecisions: ["accept"] } }), null);

process.exit(failed ? 1 : 0);
