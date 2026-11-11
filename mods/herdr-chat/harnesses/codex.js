export default {
  id: "codex",
  label: "Codex",
  images: "paste",
  mirror: true,
  prompt: { columns: true, notes: true },
  // Its sandbox, by the word its log records (turn_context), as the strip under the message box names it.
  modes: { "read-only": "Read only", "workspace-write": "Workspace write", "danger-full-access": "Full access" },
  // Its models (and their efforts) come from its own list (~/.codex/models_cache.json), which the reader passes on.
  switching: { model: "/model {model}", effort: "/model {model} --reasoning={effort}" },
  box: { style: "mark", mark: "›", stopAtBlank: true },
  skills: { triggers: ["$", "/"], invoke: "$", user: ["~/.codex/skills", "~/.agents/skills"], project: [".codex/skills", ".agents/skills"], skip: [], enterTwice: true },
  reader: "codex",
};
