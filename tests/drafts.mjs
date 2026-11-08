import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { stage } from "./stage.mjs";
const s = stage();
const herdr = join(s.dir, "node_modules", "herdr", "index.js");
writeFileSync(herdr, readFileSync(herdr, "utf8")
  .replace("shared = () => null, setShared = () => {}", "shared = k => globalThis.store[k] ?? null, setShared = (k, v) => { globalThis.store[k] = v; }"));
globalThis.store = {};
const { savedDraft, storeDraft, keptImages } = await s.load("draft.js");
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
const pic = { name: "shot.png", file: "/h/cache/herdr-chat/a.png", rel: "cache/herdr-chat/a.png" };

storeDraft("s1", { text: "look at this", attachments: [{ ...pic, extra: "dropped" }] });
check("a kept draft brings its images back after a reload", savedDraft("s1"), { text: "look at this", attachments: [pic] });
storeDraft("s2", { text: "", attachments: [pic] });
check("a draft that's only an image is kept", savedDraft("s2"), { text: "", attachments: [pic] });
check("images in kept drafts are spared from cache pruning", keptImages(), [pic.file, pic.file]);
storeDraft("s1", { text: "", attachments: [] });
check("an emptied draft is forgotten", savedDraft("s1"), null);
globalThis.store["herdr-chat.drafts"] = { old: "text from before images were kept" };
check("a draft saved as plain text still loads", savedDraft("old"), { text: "text from before images were kept", attachments: [] });
check("plain-text drafts keep no images", keptImages(), []);

s.cleanup();
process.exit(failed ? 1 : 0);
