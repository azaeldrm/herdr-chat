export default {
  id: "pi",
  label: "Pi",
  images: "path",
  mirror: true,
  prompt: {},
  box: { style: "rules" },
  skills: { triggers: ["/"], invoke: "/skill:", user: ["~/.pi/agent/skills", "~/.agents/skills"], project: [".pi/skills", ".agents/skills"], skip: [] },
  reader: "pi",
};
