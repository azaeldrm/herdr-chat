export default {
  id: "claude-code",
  label: "Claude Code",
  images: "mention",
  mirror: true,
  prompt: {},
  // Its messages on screen (model/unsaved.js): "● " then lines indented 2; a tool call reads "● Name(…)"; a "· summary" label may end one.
  screenMessage: { bullet: "●", indent: 2, tool: /^[A-Z][\w.-]*\(/, label: /\s*·\s*summary$/ },
  box: { style: "mark", mark: "❯", stopAtBlank: false },
  skills: { triggers: ["/"], invoke: "/", user: ["~/.claude/skills"], project: [".claude/skills"], skip: ["synced"] },
  reader: "claude-code",
};
