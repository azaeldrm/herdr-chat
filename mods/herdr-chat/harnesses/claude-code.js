export default {
  id: "claude-code",
  label: "Claude Code",
  images: "mention",
  mirror: true,
  prompt: {},
  // Its permission modes, by the word its log records (permission-mode entries), as the strip under the message box names them.
  modes: { default: "Ask before edits", acceptEdits: "Accept edits", plan: "Plan mode", auto: "Auto mode", bypassPermissions: "Bypass permissions", dontAsk: "Don't ask" },
  box: { style: "mark", mark: "❯", stopAtBlank: false },
  skills: { triggers: ["/"], invoke: "/", user: ["~/.claude/skills"], project: [".claude/skills"], skip: ["synced"] },
  reader: "claude-code",
};
