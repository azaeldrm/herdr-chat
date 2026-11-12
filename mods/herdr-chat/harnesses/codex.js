export default {
  id: "codex",
  label: "Codex",
  // The command that starts it, as a new tab's launch command names it (launch.js).
  command: "codex",
  images: "paste",
  mirror: true,
  prompt: { columns: true, notes: true },
  // Its collaboration mode, by the word its log records (turn_context), which Shift+Tab cycles: the footer shows
  // "Plan mode (shift+tab to cycle)" in Plan mode and nothing in the default one.
  modes: { default: "Default mode", plan: "Plan mode" },
  // Its models (and their efforts) come from its own list (~/.codex/models_cache.json), which the reader passes on.
  switching: {
    model: "/model {model}", effort: "/model {model} --reasoning={effort}", nextMode: ["shift+tab"],
    screenMode: { pattern: "(Plan mode) \\(shift\\+tab", names: { "plan mode": "Plan mode" }, none: "Default mode" },
  },
  box: { style: "mark", mark: "›", stopAtBlank: true },
  skills: { triggers: ["$", "/"], invoke: "$", user: ["~/.codex/skills", "~/.agents/skills"], project: [".codex/skills", ".agents/skills"], skip: [], enterTwice: true },
  reader: "codex",
};
