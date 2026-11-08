export default {
  id: "claude-code",
  label: "Claude Code",
  images: "mention",
  mirror: true,
  prompt: {},
  box: { style: "mark", mark: "❯", stopAtBlank: false },
  skills: { triggers: ["/"], invoke: "/", user: ["~/.claude/skills"], project: [".claude/skills"], skip: ["synced"] },
  reader: "claude-code",
};
