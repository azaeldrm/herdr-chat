import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { stage, MOD } from "./stage.mjs";
const { HARNESSES, harnessFor, supportedNames, draftPastes, textOfBox, readBack } = await stage().load("harnesses/index.js");
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};

const SHAPE = {
  id: v => typeof v === "string" && v.length > 0,
  label: v => typeof v === "string" && v.length > 0,
  images: v => ["mention", "paste", "path"].includes(v),
  mirror: v => typeof v === "boolean",
  prompt: v => v && typeof v === "object" && Object.keys(v).every(k => ["columns", "notes", "byNumber"].includes(k)),
  box: v => v && (v.style === "rules" || (v.style === "mark" && typeof v.mark === "string" && v.mark.length > 0)),
  reader: v => typeof v === "string" && v.length > 0,
};
for (const [app, h] of Object.entries(HARNESSES)) {
  check(`${app}: registered under its own id`, h.id, app);
  for (const [field, valid] of Object.entries(SHAPE)) check(`${app}: has a valid ${field}`, Boolean(valid(h[field])), true);
  check(`${app}: has no fields beyond the adapter shape`, Object.keys(h).filter(k => !(k in SHAPE)), []);
}
check("an unsupported app has no adapter", harnessFor("nope"), null);
check("the supported names read as one phrase", supportedNames(), "Claude Code, Codex or Pi");

const paste = { images: "paste" }, mention = { images: "mention" }, path = { images: "path" };
check("a pasting harness gets the paths pasted ahead of the text", draftPastes(paste, ["/a.png"], "hi"), { pastes: ["/a.png", "hi"], pasted: "hi" });
check("a mentioning harness gets @paths", draftPastes(mention, ["/a b.png"], "hi").pasted, '@"/a b.png" hi');
check("pasted image placeholders are left out of the box's text", textOfBox(paste, "[Image #1] hi"), "hi");
const img = { file: "/a.png" }, mirror = { images: [img], paths: ["/a.png"], textBox: "", pasted: "" };
check("a path harness keeps the image whose path is still in its box", readBack(path, "/a.png hi", mirror), { text: "hi", kept: [img], foreign: false });

const ids = Object.keys(HARNESSES).concat(["opencode"]);
const literal = new RegExp(`["'](${ids.map(i => i.replace(/[-]/g, "\\-")).join("|")})["']`);
const ALLOWED = [/^harnesses\//, /^read_session\.py$/, /^read-session\.ps1$/, /^vendor\//];
function files(dir) {
  // Every file under dir, as paths relative to the mod.
  return readdirSync(dir).flatMap(f => statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]);
}
for (const file of files(MOD).filter(f => /\.(js|py|ps1|sh)$/.test(f))) {
  const rel = relative(MOD, file);
  if (ALLOWED.some(r => r.test(rel))) continue;
  const hit = readFileSync(file, "utf8").split("\n").find(l => literal.test(l));
  check(`${rel} names no harness (harness behavior belongs in harnesses/)`, hit ?? null, null);
}

process.exit(failed ? 1 : 0);
