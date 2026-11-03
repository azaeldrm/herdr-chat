// withoutRetracted: hiding a message the agent handed back on Stop.   node tests/retracted.mjs
import { stage } from "./stage.mjs";
const s = stage();
const { withoutRetracted } = await s.load("transcript.js");
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) failed++; };
const said = [{ kind: "message", role: "assistant", text: "hi" }, { kind: "message", role: "user", text: "write a story" }];
let r = withoutRetracted(said, "write a story");
check(r.rows.length === 1 && r.retracted, "the handed-back message is hidden while it's the last thing said");
r = withoutRetracted(said, null);
check(r.rows.length === 2, "nothing hidden without a mark");
r = withoutRetracted([...said, { kind: "message", role: "assistant", text: "a reply" }], "write a story");
check(r.rows.length === 3 && !r.retracted, "once anything follows it, it shows again and the mark is spent");
r = withoutRetracted([...said, { kind: "message", role: "user", text: "something else" }], "write a story");
check(r.rows.length === 3 && !r.retracted, "a newer message spends the mark");
r = withoutRetracted([{ kind: "message", role: "user", text: "write a story" }, { kind: "tools", calls: [] }], "write a story");
check(r.rows.length === 2 && !r.retracted, "not hidden once the agent did something after it");
s.cleanup();
if (failed) process.exit(1);
