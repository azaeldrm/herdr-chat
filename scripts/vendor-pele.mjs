// Copies Pele (the version pinned in package.json) into mods/herdr-chat/vendor/pele: its core and
// the diagram types below, with every file they import, keeping Pele's own layout so its relative
// imports work. herdr loads a mod only from its own folder and has no npm, so the copy is
// committed; npm is needed only to update it.
//   npm install && npm run vendor:pele         update the copy
//   node scripts/vendor-pele.mjs --check       fail if the copy differs from the pinned version
import { readFileSync, existsSync, mkdirSync, copyFileSync, rmSync, readdirSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

// The diagram types the chat draws. Each adds its own file plus any chunks the others don't share.
export const DIAGRAMS = ["flowchart", "sequence", "state", "class", "er", "gantt", "pie", "mindmap", "timeline", "gitGraph"];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "node_modules", "pele");
const esm = join(pkg, "dist", "esm");
const out = join(root, "mods", "herdr-chat", "vendor", "pele");
const check = process.argv.includes("--check");

const pinned = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies.pele;
if (!existsSync(pkg)) {
  if (check && existsSync(join(out, "README.txt"))) {
    // without node_modules, check what the README says was copied against the pin
    const copied = /Pele (\S+)/.exec(readFileSync(join(out, "README.txt"), "utf8"))?.[1];
    if (copied !== pinned) { console.error(`vendor/pele holds Pele ${copied}, package.json pins ${pinned}: run npm install && npm run vendor:pele`); process.exit(1); }
    console.log(`vendor/pele is Pele ${copied} (contents not compared: run npm install for that)`);
    process.exit(0);
  }
  console.error("node_modules/pele is missing: run npm install first"); process.exit(1);
}
const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version;
if (version !== pinned) { console.error(`node_modules has Pele ${version}, package.json pins ${pinned}: run npm install`); process.exit(1); }

// Every file reachable from the entries through relative imports, static or dynamic.
const files = new Set();
const follow = file => {
  if (files.has(file)) return;
  files.add(file);
  const source = readFileSync(join(esm, file), "utf8");
  for (const m of source.matchAll(/from\s*["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)|import\s*["'](\.[^"']+)["']/g))
    follow(relative(esm, resolve(dirname(join(esm, file)), m[1] ?? m[2] ?? m[3])));
};
for (const entry of ["core.js", ...DIAGRAMS.map(d => `diagrams/${d}.js`)]) follow(entry);

const readme = `Pele ${version} (https://github.com/obsidianmd/pele), MIT: see LICENSE.\n` +
  `Copied by scripts/vendor-pele.mjs from npm: core and ${DIAGRAMS.join(", ")}.\nDon't edit: change the pin in package.json and run npm run vendor:pele.\n`;
const wanted = new Map([...files].map(f => [f, readFileSync(join(esm, f))]));
wanted.set("LICENSE", readFileSync(join(pkg, "LICENSE")));
wanted.set("README.txt", Buffer.from(readme));

const existing = [];
const walk = d => { if (existsSync(d)) for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : existing.push(relative(out, p)); } };
walk(out);

if (check) {
  const problems = [];
  for (const [f, bytes] of wanted) if (!existsSync(join(out, f)) || !readFileSync(join(out, f)).equals(bytes)) problems.push(`differs or missing: ${f}`);
  for (const f of existing) if (!wanted.has(f)) problems.push(`not from Pele ${version}: ${f}`);
  if (problems.length) { console.error(problems.join("\n") + "\nrun npm run vendor:pele"); process.exit(1); }
  console.log(`vendor/pele matches Pele ${version}: ${wanted.size} files`);
} else {
  rmSync(out, { recursive: true, force: true });
  for (const [f, bytes] of wanted) { mkdirSync(dirname(join(out, f)), { recursive: true }); writeFileSync(join(out, f), bytes); }
  const kb = [...wanted.values()].reduce((n, b) => n + b.length, 0) >> 10;
  console.log(`copied Pele ${version}: ${wanted.size} files, ${kb} KB, into ${relative(root, out)}`);
}
