import { stage } from "./stage.mjs";
const s = stage();
const { runsWith, modelName, tokens, switchCommand } = await s.load("model/runs-with.js");
const { harnessFor } = await s.load("harnesses/index.js");
let failed = 0;
const check = (got, want, what) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
const claude = harnessFor("claude-code"), codex = harnessFor("codex");
check(modelName("claude-opus-5-5"), "Opus 5.5", "a Claude model reads as its family and version");
check(modelName("gpt-6-luna"), "gpt-6-luna", "other models as named");
check([tokens(950), tokens(80341), tokens(1250000), tokens(1000000)], ["950", "80k", "1.25M", "1M"], "token counts read short");

const c = runsWith({ model: "claude-opus-5-5", effort: "medium", mode: "auto", context: 382000 }, claude);
check([c.model.name, c.effort, c.mode.text], ["Opus 5.5", "medium", "Auto mode"], "Claude: the model, effort and mode");
check(c.context, { used: 382000, window: 1000000, share: 38 }, "Claude: the model's known window gives the context a share");
check(c.models.map(m => m.switchTo), ["opus", "sonnet", "haiku", "fable"], "Claude switches models by alias");
check(runsWith({ model: "claude-haiku-5-5", context: 5000 }, claude).context, { used: 5000, window: null, share: null }, "a model whose window isn't known: tokens only");

const models = [{ id: "gpt-6-luna", name: "GPT-6 Luna", efforts: ["low", "high"] }, { id: "gpt-6-mini", name: "GPT-6 mini", efforts: ["low"] }];
const x = runsWith({ model: "gpt-6-luna", effort: "high", mode: "plan", context: 164132, window: 258400, models }, codex);
check([x.model.name, x.mode.text, x.context.share, x.efforts], ["GPT-6 Luna", "Plan mode", 64, ["low", "high"]], "Codex: its own model list, the model's efforts, its window");

check(switchCommand(claude, "model", { model: "sonnet" }), "/model sonnet", "the model switch, as Claude takes it");
check(switchCommand(codex, "effort", { model: "gpt-6-luna", effort: "low" }), "/model gpt-6-luna --reasoning=low", "Codex switches effort through /model");
check(switchCommand({}, "model", { model: "x" }), null, "a harness that can't switch: nothing");
check(runsWith({}, claude).model, null, "nothing logged yet: no model");
process.exit(failed ? 1 : 0);
