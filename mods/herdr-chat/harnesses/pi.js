export default {
  id: "pi",
  label: "Pi",
  // The command that starts it, as a new tab's launch command names it (launch.js).
  command: "pi",
  images: "path",
  mirror: true,
  prompt: {},
  box: { style: "rules" },
  skills: { triggers: ["/"], invoke: "/skill:", user: ["~/.pi/agent/skills", "~/.agents/skills"], project: [".pi/skills", ".agents/skills"], skip: [] },
  reader: "pi",
  // Its thinking levels, which Shift+Tab cycles; it says the new one as "Thinking level: low". No permission modes.
  efforts: ["off", "minimal", "low", "medium", "high", "xhigh"],
  switching: { nextEffort: ["shift+tab"], screenEffort: { pattern: "Thinking level: (\\w+)" } },
};
