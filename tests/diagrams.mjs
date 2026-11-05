import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { stage } from "./stage.mjs";

const staged = stage();
const { splitDiagrams, diagramFor, renderQueuedDiagrams, hasQueuedDiagrams, bake } = await staged.load("diagrams.js");
let failed = 0;
const check = (ok, what, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : "  " + detail}`); if (!ok) failed++; };
const theme = { background: "#101215", foreground: "#dededb", muted: "#9a9fa2", surface: "#16191d", raised: "#1c2025", border: "#2a2f35", accent: "#e0a030" };

const parts = splitDiagrams("Here it is:\n```mermaid\nflowchart LR\n  A --> B\n```\nAnd that's all.");
check(JSON.stringify(parts?.map(p => p.kind)) === '["text","diagram","text"]' && parts[1].text === "flowchart LR\n  A --> B", "reply splits around its mermaid block", JSON.stringify(parts));
check(splitDiagrams("no diagram here") === null, "a reply without one isn't split");

const flow = diagramFor("flowchart LR\n  A[Chat box] --> B{Mirror?}\n  B -->|yes| C[Agent box]", theme);
check(flow.state === "queued" && hasQueuedDiagrams(), "a new diagram is queued, not drawn while rendering");
check(await renderQueuedDiagrams() === 1, "the queued diagram draws");
check(flow.state === "ready" && flow.width > 0 && flow.height > 0, "it has a size", JSON.stringify(flow));
const file = join(staged.home, flow.rel ?? "");
const svg = existsSync(file) ? readFileSync(file, "utf8") : "";
check(svg.startsWith("<svg") && !svg.includes("var("), "its SVG is written with no CSS variables left", svg.slice(0, 80));
check(svg.includes(theme.foreground) && svg.includes(theme.muted) && svg.includes(theme.surface), "the theme's colors are in it");
check(/font-family:Geist, 'Noto Sans'/.test(svg) && !/font-family:Geist[;"]/.test(svg), "labels name a list of fonts, not Geist alone (it isn't a system font)", (svg.match(/font-family:[^;"]*/) ?? [""])[0]);

const raw = '<svg style="--_bg:var(--pele-bg,#fff);--_c:var(--pele-accent,#5b7bd5)"><rect fill="var(--_bg)" style="rx:4px"/><path stroke="var(--_c)"/></svg>';
check(bake(raw, { bg: "#000000" }) === '<svg style=""><rect fill="#000000" rx="4"/><path stroke="#5b7bd5"/></svg>', "bake: theme color, Pele's default for an unset one, radius as attribute", bake(raw, { bg: "#000000" }));

const pie = diagramFor('pie title Agents\n  "Claude" : 3\n  "Codex" : 2', theme);
await renderQueuedDiagrams();
const pieSvg = pie.state === "ready" ? readFileSync(join(staged.home, pie.rel), "utf8") : "";
check(pie.state === "ready" && !pieSvg.includes("var(") && pieSvg.includes("#4c78a8"), "series colors (pie) are written in too, from Pele's palette", pieSvg.match(/var\([^)]*\)/)?.[0] ?? pie.state);

const many = ["flowchart LR\n  X1 --> Y1", "flowchart LR\n  X2 --> Y2", "pie\n  \"a\" : 1\n  \"b\" : 2", "flowchart LR\n  X3 --> Y3"].map(src => diagramFor(src, theme));
const drawn = await renderQueuedDiagrams();
check(drawn === 4 && many.every(d => d.state === "ready") && !hasQueuedDiagrams(), "several queued diagrams draw in one batch (one layout change, not one each)", `drew ${drawn}`);

const bad = diagramFor("flowchart LR\n  A -->", theme);
await renderQueuedDiagrams();
check(bad.state === "failed" && bad.error, "a diagram Pele can't parse fails with its reason (its source shows instead)", JSON.stringify(bad));

check(diagramFor(flow.source, { ...theme, foreground: "#000000" }).key !== flow.key, "another theme draws its own copy");

staged.cleanup();
if (failed) process.exit(1);
