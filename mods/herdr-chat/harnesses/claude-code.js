export default {
  id: "claude-code",
  label: "Claude Code",
  images: "mention",
  mirror: true,
  prompt: {},
  // Its permission modes, by the word its log records (permission-mode entries), as the strip under the message box names them.
  modes: { default: "Ask before edits", acceptEdits: "Accept edits", plan: "Plan mode", auto: "Auto mode", bypassPermissions: "Bypass permissions", dontAsk: "Don't ask" },
  // What the chat offers to switch to (the model chip and the effort menu), how it switches, and its context windows where known.
  models: [
    { id: "claude-opus-5-5", alias: "opus", name: "Opus 5.5", window: 1000000 },
    { id: "claude-sonnet-5-5", alias: "sonnet", name: "Sonnet 5.5" },
    { id: "claude-haiku-5-5", alias: "haiku", name: "Haiku 5.5" },
    { id: "claude-fable-5-2", alias: "fable", name: "Fable 5.2" },
  ],
  efforts: ["low", "medium", "high", "xhigh", "max"],
  // screenModes: the footer's words for each mode, read after a Shift+Tab (the log records the mode only with a message).
  switching: {
    model: "/model {model}", effort: "/effort {effort}", nextMode: ["shift+tab"],
    screenModes: { "auto mode on": "Auto mode", "manual mode on": "Ask before edits", "accept edits on": "Accept edits", "plan mode on": "Plan mode", "bypass permissions on": "Bypass permissions" },
  },
  box: { style: "mark", mark: "❯", stopAtBlank: false },
  skills: { triggers: ["/"], invoke: "/", user: ["~/.claude/skills"], project: [".claude/skills"], skip: ["synced"] },
  reader: "claude-code",
};
