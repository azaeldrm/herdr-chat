import { stage } from "./stage.mjs";
const s = stage();
const { rowRuns, frameRuns } = await s.load("backdrop/runs.js");
const { SharkCells } = await s.load("backdrop/scenes/sharks/cells.js");
const { Palette } = await s.load("backdrop/palette.js");
const { World } = await s.load("backdrop/vendor/ascii-sharks/world.js");
const { cellSize } = await s.load("backdrop/config.js");
const { pickSharks } = await s.load("backdrop/scenes/sharks/config.js");
const { KINDS } = await s.load("backdrop/scenes/sharks/shapes.js");
let failed = 0;
const check = (got, want, what) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};

// One row from strings: glyphs, a colour letter per cell (. none) and a background letter per cell (. none).
const row = (g, f, b) => rowRuns([...g], [...f].map(x => x === "." ? null : x), [...b].map(x => x === "." ? null : x), g.length, 0)
  .map(u => [u.col, u.text, u.fg, u.bg]);
check(row("          ", "..........", ".........."), [], "an empty row draws nothing");
check(row("  - -  -  ", "..a.a..a..", ".........."), [[2, "- -  -", "a", null]], "fish of one colour and the spaces between them are one run, trimmed at both ends");
check(row(" -- -     ", ".ab.b.....", ".........."), [[1, "-", "a", null], [2, "- -", "b", null]], "a new colour starts a new run");
check(row("  St  ", "..xy..", "..PP.."), [[2, "S", "x", "P"], [3, "t", "y", "P"]], "on one background, glyphs of two colours are two runs");
check(row("  :;  ", "..xx..", "..PQ.."), [[2, ":", "x", "P"], [3, ";", "x", "Q"]], "a background change ends a run");
check(row("   ", "...", ".P."), [[1, " ", null, "P"]], "a blank cell with a background still draws");

const theme = { background: "#080a0b", foreground: "#dededb", accent: "#e9aa35", done: "#10a7a7" };
const pal = new Palette(theme);
check([pal.mix(255, 255, 255, 0), pal.mix(255, 255, 255, 1)], ["#080c0c", "#fcfcfc"], "colours mix over the background, rounded");
check(pal.mix(10, 200, 30, 0.5) === pal.mix(10, 200, 30, 0.5), true, "the same colour is the same string");

const sharks = pickSharks(() => 0.5);
check([sharks.length, new Set(sharks.map(x => x.kind)).size, sharks.every(x => KINDS.includes(x.kind))], [3, 3, true], "three sharks, all of different known kinds");

// The sim and the cells on a chat-sized page: it runs, sharks and fish land in cells, dimming dims all of it.
const { cw, ch } = cellSize();
const world = new World([{ kind: "hammerhead", size: 1.6 }, { kind: "tiger", size: 1.3 }, { kind: "zebra", size: 1.1 }]);
const cells = new SharkCells();
cells.resize(1200, 640, cw, ch);
world.resize(1200, 640, cw, ch);
cells.setDim(0.45);
for (let f = 0; f < 60; f++) { world.step(1 / 24); world.step(1 / 24); cells.frame(world, 1 / 12, pal); }
const n = cells.cols * cells.rows;
let shark = 0, fish = 0;
for (let i = 0; i < n; i++) { if (cells.bg[i]) shark++; else if (cells.glyph[i] === "-") fish++; }
check([cells.cols, cells.rows], [Math.ceil(1200 / cw), Math.ceil(640 / ch)], "the grid covers the page");
check([shark > 50, fish > 20], [true, true], "sharks and fish are drawn");
const mid = Math.floor(cells.rows / 2) * cells.cols + Math.floor(cells.cols / 2);
check([cells.fade[mid], cells.fade[0]].map(v => v.toFixed(3)), ["0.417", "0.417"], "the whole scene is dimmed evenly");
const runs = frameRuns(cells);
check(runs.length, cells.rows, "a list of runs per row");
check(runs.flat().every(u => u.text.length === u.len && u.len > 0), true, "every run's text fills its cells");

// Every scene: it runs on a chat-sized page, draws something, and its runs fill their cells; the button cycles them.
const { SCENES, sceneFor, nextScene } = await s.load("backdrop/scenes/index.js");
for (const entry of SCENES) {
  const scene = entry.make();
  scene.resize(1200, 640, cw, ch); scene.setDim(0.3);
  scene.pointer.active = true; scene.pointer.x = 300; scene.pointer.y = 200;
  for (let f = 0; f < 90; f++) { if (f === 40) scene.splash(600, 320); scene.frame(1 / 30, pal); }
  const g = scene.grid, drawn = g.glyph.filter(x => x !== " ").length;
  const ok = frameRuns(g).flat().every(u => u.text.length === u.len && u.len > 0);
  check([drawn > 20, ok, g.cols * g.rows === g.glyph.length], [true, true, true], `${entry.label}: draws on the whole grid, as runs that fill their cells`);
}
check(SCENES.map(() => 0).reduce(id => nextScene(id).id, "sharks"), "sharks", "the button steps through every scene and back to the first");
check([sceneFor("nope").id, sceneFor(undefined).id], ["sharks", "sharks"], "an unknown or missing scene is the sharks");

s.cleanup();
process.exit(failed ? 1 : 0);
