export function parseChoices(screen) {
  const lines = screen.replace(/ /g, " ").split("\n").map(l => l.replace(/\s+$/, ""));
  const FOOTER = /enter to (select|confirm)|↑\/↓|to navigate|esc to cancel/i;
  const RULE = /^\s*[─━═]{8,}\s*$/;
  const SOFT_RULE = /^\s*[╌┄┈-]{8,}\s*$/;
  const CURSOR = /^(\s*)([❯›>▸➤])\s+(\S.*)$/;
  const NUMBERED = /^(\s*)(?:[❯›>▸➤]\s+)?(\d+)[.)]\s+(.+)$/;
  let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end--;
  let footer = -1;
  for (let y = end; y >= Math.max(0, end - 6); y--) if (FOOTER.test(lines[y])) { footer = y; break; }
  if (footer < 0) return null;
  let y = footer - 1;
  let more = false;
  while (y >= 0 && (!lines[y].trim() || RULE.test(lines[y]) || /^\s*[↓↑]\s*$/.test(lines[y]))) { if (/↓/.test(lines[y])) more = true; y--; }
  const block = [];
  let numbered = null;
  for (; y >= 0 && footer - y < 40; y--) {
    const line = lines[y];
    const n = NUMBERED.exec(line), c = CURSOR.exec(line);
    if (numbered !== false && n) { numbered = true; block.unshift({ y, line }); continue; }
    if (numbered === null && c) { numbered = false; block.unshift({ y, line }); continue; }
    if (numbered === false && block.length) {
      const col = CURSOR.exec(block.find(b => CURSOR.test(b.line))?.line ?? "")?.[1].length;
      const text = /^(\s*)(\S.*)$/.exec(line);
      if (c || (text && col != null && text[1].length === col + 2)) { block.unshift({ y, line }); continue; }
      break;
    }
    if (block.length && (!line.trim() || /^\s{4,}\S/.test(line))) { block.unshift({ y, line, desc: true }); continue; }
    break;
  }
  const options = [];
  for (const b of block) {
    if (b.desc) { if (options.length && b.line.trim()) options.at(-1).desc.push(b.line.trim()); continue; }
    const n = NUMBERED.exec(b.line), c = CURSOR.exec(b.line);
    const label = (n ? n[3] : c ? c[3] : b.line.trim()).trim();
    options.push({ n: n ? Number(n[2]) : options.length + 1, label, desc: [], selected: Boolean(c) || /^\s*[❯›>▸➤]/.test(b.line) });
  }
  if (options.length < 2 || options.filter(o => o.selected).length !== 1) return null;
  const question = [];
  let tabs = null;
  for (let q = (block[0]?.y ?? footer) - 1, blanks = 0; q >= 0 && question.length < 10; q--) {
    const line = lines[q];
    if (RULE.test(line)) break;
    if (SOFT_RULE.test(line)) continue;
    if (/^\s*[•●⎿⏺]/.test(line) || /^\s*[❯›]\s/.test(line)) break;
    if (!line.trim()) { if (++blanks >= 2 && question.length) break; continue; }
    blanks = 0;
    if (/[□☐■☑☒✓✔]/.test(line) && /submit/i.test(line)) { tabs = line.trim(); continue; }
    question.unshift(line.trim());
  }
  const sig = JSON.stringify([question, options.map(o => o.label)]);
  return { question, tabs, options, more, sig };
}
