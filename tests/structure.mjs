import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { MOD } from "./stage.mjs";
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
const read = f => readFileSync(join(MOD, f), "utf8");
const walk = dir => readdirSync(dir).flatMap(f => f === "vendor" ? [] : statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith(".js") ? [relative(MOD, join(dir, f))] : []);

const HOST = {
  "components/chat-list.js": [],
  "components/question-card.js": ["sending", "note", "key", "list.following", "list.follow"],
  "components/composer.js": ["sending", "note", "key", "list.following", "list.follow", "card.choices", "card.stillCurrent", "stop", "stopping"],
  "components/session-reader.js": ["card.read", "list.following", "list.follow"],
};
for (const [file, allowed] of Object.entries(HOST)) {
  const used = [...new Set([...read(file).matchAll(/this\.host\.(\w+)(?:\.(\w+))?/g)].map(m => {
    const top = m[1], sub = m[2];
    return ["list", "card", "composer", "reader"].includes(top) && sub ? `${top}.${sub}` : top;
  }))].sort();
  check(`${file} uses only its documented host API`, used.filter(u => !allowed.includes(u)), []);
}
for (const file of walk(MOD).filter(f => f.startsWith("components/"))) {
  check(`${file} has a host entry in this test`, file in HOST, true);
  check(`${file} doesn't reach into another component's fields`, read(file).match(/this\.(list|card|composer|reader)\.\w+/g) ?? [], []);
}
const mixins = [...read("main.js").matchAll(/Object\.assign\(HerdrChat\.prototype, (\w+)\)/g)].map(m => m[1]);
check("the view mixes in nothing", mixins, []);
for (const file of walk(MOD).filter(f => f.startsWith("model/")))
  check(`${file} is pure data (no gpui or herdr imports)`, read(file).match(/from "(gpui-kit|gpui-base|herdr)"/g) ?? [], []);
check("rows are drawn from (row, ctx), not from the view", /\bthis\./.test(read("ui/rows.js")), false);
for (const file of walk(MOD)) check(`${file} keeps state off other objects (no Object.assign onto this)`, /Object\.assign\(this,/.test(read(file)), false);

process.exit(failed ? 1 : 0);
