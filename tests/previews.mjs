import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { stage } from "./stage.mjs";

const s = stage();
const { previewName, keepSent, sentNames } = await s.load("images.js");
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
const placed = (t, name) => `/home/a/.local/state/herdr-core/default/files/${t}/${name}`;

check("a preview name says where the image was placed", previewName(placed("t4k", "same.png")), "local~t4k~same.png");
check("the same name in two terminals stays apart", previewName(placed("t4k", "same.png")) === previewName(placed("t4s", "same.png")), false);
check("the same terminal on two machines stays apart", previewName(placed("t7", "same.png"), "homelab") === previewName(placed("t7", "same.png")), false);
check("a Windows path and an odd machine name give a plain file name", previewName(String.raw`C:\Users\a\herdr-core\default\files\t7\x.png`, "my box/1"), "my-box-1~t7~x.png");

const cache = join(s.home, "cache", "herdr-chat"), sent = join(cache, "sent");
mkdirSync(cache, { recursive: true });
const a = join(cache, "a.png"), b = join(cache, "b.png");
writeFileSync(a, new Uint8Array([1, 2, 255])); writeFileSync(b, new Uint8Array([9]));
const kept = await keepSent([a, b], [placed("t4k", "same.png"), placed("t4s", "same.png")], null);
check("sent previews move under their placed names", kept, ["local~t4k~same.png", "local~t4s~same.png"]);
check("their bytes are kept, whole", [...readFileSync(join(sent, kept[0]))], [1, 2, 255]);
check("the originals are gone", [existsSync(a), existsSync(b)], [false, false]);

const old = (Date.now() - 40 * 86400000).toString(36), fresh = Date.now().toString(36);
writeFileSync(join(sent, `local~t1~${old}abc-old.png`), "x");
writeFileSync(join(sent, `local~t1~${fresh}abc-new.png`), "x");
const names = await sentNames();
check("older than 30 days goes; recent, and names without a time, stay", [...names].sort(), [`local~t1~${fresh}abc-new.png`, "local~t4k~same.png", "local~t4s~same.png"].sort());
check("and it's gone from disk", readdirSync(sent).some(f => f.includes("-old.png")), false);
const base = Date.now(), many = i => `local~t2~${(base + i * 1000).toString(36)}abc-n${i}.png`;
for (let i = 0; i < 305; i++) writeFileSync(join(sent, many(i)), "x");
const capped = await sentNames();
check("at most 300 are kept", capped.length, 300);
check("the newest stay and the oldest go", [capped.includes(many(304)), existsSync(join(sent, many(304))), existsSync(join(sent, many(0)))], [true, true, false]);

s.cleanup();
process.exit(failed ? 1 : 0);
