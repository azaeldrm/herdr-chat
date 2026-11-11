export default {
  id: "codex",
  label: "Codex",
  images: "paste",
  mirror: true,
  prompt: { columns: true, notes: true },
  // Its sandbox, by the word its log records (turn_context), as the strip under the message box names it.
  modes: { "read-only": "Read only", "workspace-write": "Workspace write", "danger-full-access": "Full access" },
  box: { style: "mark", mark: "›", stopAtBlank: true },
  skills: { triggers: ["$", "/"], invoke: "$", user: ["~/.codex/skills", "~/.agents/skills"], project: [".codex/skills", ".agents/skills"], skip: [], enterTwice: true },
  reader: "codex",
};
