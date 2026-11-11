import { stage } from "./stage.mjs";
const s = stage();
const { runsWith, modelName, tokens } = await s.load("model/runs-with.js");
const { harnessFor } = await s.load("harnesses/index.js");
let failed = 0;
const check = (got, want, what) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
check(modelName("claude-opus-5-5"), "Opus 5.5", "a Claude model reads as its family and version");
check(modelName("claude-haiku-5-5-20260101"), "Haiku 5.5", "a dated Claude model too");
check(modelName("gpt-6-luna"), "gpt-6-luna", "other models as named");
check([tokens(950), tokens(80341), tokens(1250000)], ["950", "80k", "1.25M"], "token counts read short");
const claude = harnessFor("claude-code").modes, codex = harnessFor("codex").modes;
check(runsWith({ model: "claude-opus-5-5", effort: "medium", mode: "auto", context: 80341 }, claude).map(p => p.text),
  ["Opus 5.5", "medium effort", "Auto mode", "80k context"], "Claude: model, effort, mode and context used");
check(runsWith({ model: "gpt-6-luna", effort: "high", mode: "workspace-write", context: 164132, window: 258400 }, codex).map(p => p.text),
  ["gpt-6-luna", "high effort", "Workspace write", "64% context"], "Codex: its window gives the context as a share");
check(runsWith({ mode: "somethingNew" }, claude).map(p => p.text), ["somethingNew"], "a mode the harness doesn't name shows as logged");
check(runsWith({}, claude), [], "nothing logged yet: nothing to show");
process.exit(failed ? 1 : 0);
