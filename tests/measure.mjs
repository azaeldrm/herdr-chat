import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { stage, MOD } from "./stage.mjs";
const { zoomFrom, designPx, designHeight, PROBE_PX } = await stage().load("measure.js");
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
const near = (a, b) => Math.abs(a - b) < 1e-6;

check("the probe reads zoom 0.9 from a 100px box laid out at 90", near(zoomFrom({ width: PROBE_PX * 0.9, height: 90 }), 0.9), true);
check("an unmeasured probe means zoom 1", zoomFrom(undefined), 1);
check("reported pixels convert back to design px", near(designPx(864, 0.9), 960), true);
check("a row measured at zoom 0.9 gets its full slot back", near(designHeight({ width: 666, height: 1561.68 }, 740), 1735.2), true);
check("at zoom 1 a row's height is unchanged", designHeight({ width: 740, height: 400 }, 740), 400);

function handlers(source) {
  // The text of each .on_size_change(...) call in source.
  const out = [];
  for (let i = source.indexOf(".on_size_change("); i !== -1; i = source.indexOf(".on_size_change(", i + 1)) {
    let depth = 0, j = i + ".on_size_change".length;
    do { if (source[j] === "(") depth++; else if (source[j] === ")") depth--; j++; } while (depth > 0 && j < source.length);
    out.push(source.slice(i, j));
  }
  return out;
}
function files(dir) {
  // Every .js file under dir except vendored code.
  return readdirSync(dir).flatMap(f => f === "vendor" ? [] : statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".js") ? [join(dir, f)] : []);
}
for (const path of files(MOD).filter(f => !f.endsWith("measure.js"))) {
  const file = relative(MOD, path);
  for (const h of handlers(readFileSync(path, "utf8")))
    check(`${file}: on_size_change converts zoomed pixels through measure.js (${h.slice(0, 60).replace(/\s+/g, " ")}…)`,
      /designPx\(|designHeight\(|zoomFrom\(/.test(h), true);
}
check("main.js keeps the zoom probe", /zoomProbe\(/.test(readFileSync(join(MOD, "main.js"), "utf8")), true);

process.exit(failed ? 1 : 0);
