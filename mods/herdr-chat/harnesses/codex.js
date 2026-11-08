export default {
  id: "codex",
  label: "Codex",
  images: "paste",
  mirror: true,
  prompt: { columns: true, notes: true },
  box: { style: "mark", mark: "›", stopAtBlank: true },
  skills: { triggers: ["$", "/"], invoke: "$", user: ["~/.codex/skills", "~/.agents/skills"], project: [".codex/skills", ".agents/skills"], skip: [], enterTwice: true },
  reader: "codex",
};
