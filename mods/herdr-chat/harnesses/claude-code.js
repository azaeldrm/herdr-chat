export default {
  id: "claude-code",
  label: "Claude Code",
  images: "mention",
  mirror: true,
  prompt: {},
  // Its messages on screen (model/unsaved.js): "● " then lines indented 2; a tool call reads "● Name(…)".
  screenMessage: { bullet: "●", indent: 2, tool: /^[A-Z][\w.-]*\(/ },
  box: { style: "mark", mark: "❯", stopAtBlank: false },
  skills: { triggers: ["/"], invoke: "/", user: ["~/.claude/skills"], project: [".claude/skills"], skip: ["synced"] },
  reader: "claude-code",
};
