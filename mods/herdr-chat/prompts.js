const FOOTER = /enter to (select|confirm|submit)|↑\/↓|↑↓|to navigate|esc to cancel|esc (back|dismiss)/i;
const REVIEW = /ready to submit your answers\?/i;
const CHECKBOX = /^\[([ xX✓✔])\]\s*(.*)$/;
const NEXT_ROW = /^\s*(?:[❯›>▸➤]\s+)?Next$/;

const ADAPTERS = {
  "claude-code": {},
  pi: {},
  opencode: { byNumber: true },
};

function screenLines(screen) {
  // The screen's lines without trailing space or the frame some harnesses draw around a prompt.
  return screen.replace(/\u00a0/g, " ").split("\n").map(l => l.replace(/^\s*[┃│] ?/, "").replace(/\s*[┃│]?\s*$/, ""));
}

function findFooter(lines, end) {
  // The line that closes a prompt, or -1. The review step has no footer, so its question closes it.
  for (let y = end; y >= Math.max(0, end - 6); y--) if (FOOTER.test(lines[y])) return y;
  for (let y = end; y >= Math.max(0, end - 6); y--) if (REVIEW.test(lines[y])) return lines.length;
  return -1;
}

export function looksLikePrompt(screen) {
  // Whether the screen ends like a prompt, even one whose choices can't be read.
  const lines = screenLines(screen);
  let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end--;
  return findFooter(lines, end) >= 0;
}

export function parsePrompt(app, screen) {
  // The prompt on an agent's screen, read the way that agent draws it.
  return parseChoices(screen, ADAPTERS[app] ?? {});
}

export function keysFor(app, prompt, index) {
  // The keys that act on one option: its number where the harness takes one, else arrows from the selected one and Enter.
  const option = prompt.options[index];
  if (ADAPTERS[app]?.byNumber) return option.next ? ["tab"] : [String(option.n)];
  const from = prompt.options.findIndex(o => o.selected);
  return [...Array(Math.abs(index - from)).fill(index > from ? "down" : "up"), "enter"];
}

export function parseChoices(screen, { byNumber = false } = {}) {
  const lines = screenLines(screen);
  const RULE = /^\s*[─━═]{8,}\s*$/;
  const SOFT_RULE = /^\s*[╌┄┈-]{8,}\s*$/;
  const CURSOR = /^(\s*)([❯›>▸➤])\s+(\S.*)$/;
  const NUMBERED = /^(\s*)(?:[❯›>▸➤]\s+)?(\d+)[.)]\s+(.+)$/;
  let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end--;
  const footer = findFooter(lines, end);
  if (footer < 0) return null;
  let y = footer - 1;
  let more = false;
  while (y >= 0 && (!lines[y].trim() || RULE.test(lines[y]) || /^\s*[↓↑]\s*$/.test(lines[y]))) { if (/↓/.test(lines[y])) more = true; y--; }
  const block = [];
  let numbered = null;
  for (; y >= 0 && footer - y < 40; y--) {
    const line = lines[y];
    const n = NUMBERED.exec(line), c = CURSOR.exec(line);
    if (numbered !== false && NEXT_ROW.test(line)) { numbered = true; block.unshift({ y, line, next: true }); continue; }
    if (numbered !== false && n) { numbered = true; block.unshift({ y, line }); continue; }
    if (numbered === true && RULE.test(line)) continue;
    if (numbered === null && c) { numbered = false; block.unshift({ y, line }); continue; }
    if (numbered === false && block.length) {
      const col = CURSOR.exec(block.find(b => CURSOR.test(b.line))?.line ?? "")?.[1].length;
      const text = /^(\s*)(\S.*)$/.exec(line);
      if (c || (text && col != null && text[1].length === col + 2)) { block.unshift({ y, line }); continue; }
      break;
    }
    if (!line.trim() || /^\s{2,}\S/.test(line)) { block.unshift({ y, line, desc: true }); continue; }
    break;
  }
  while (block[0]?.desc) block.shift();
  const options = [];
  for (const b of block) {
    if (b.desc) { if (options.length && b.line.trim()) options.at(-1).desc.push(b.line.trim()); continue; }
    const n = NUMBERED.exec(b.line), c = CURSOR.exec(b.line);
    const selected = Boolean(c) || /^\s*[❯›>▸➤]/.test(b.line);
    if (b.next) { options.push({ n: null, label: "Next", desc: [], selected, next: true }); continue; }
    const text = (n ? n[3] : c ? c[3] : b.line.trim()).trim();
    const box = CHECKBOX.exec(text);
    options.push({ n: n ? Number(n[2]) : options.length + 1, label: box ? box[2] : text, desc: [], selected, ...(box ? { checked: box[1] !== " " } : {}) });
  }
  const multi = options.some(o => o.checked !== undefined);
  if (byNumber && multi && !options.some(o => o.next)) options.push({ n: null, label: "Next", desc: [], selected: false, next: true });
  if (options.length < 2 || (!byNumber && options.filter(o => o.selected).length !== 1)) return null;
  const question = [];
  let tabs = null;
  for (let q = (block[0]?.y ?? footer) - 1, blanks = 0; q >= 0 && question.length < 10; q--) {
    const line = lines[q];
    if (RULE.test(line)) break;
    if (SOFT_RULE.test(line)) continue;
    if (/^\s*[•●⎿⏺]/.test(line) || /^\s*[❯›]\s/.test(line)) break;
    if (!line.trim()) { if (++blanks >= 2 && question.length) break; continue; }
    blanks = 0;
    question.unshift(line.trim());
  }
  for (let q = (block[0]?.y ?? footer) - 1; q >= 0 && !RULE.test(lines[q]) && block[0].y - q < 12; q--) {
    if (/\bsubmit\b/i.test(lines[q]) && !REVIEW.test(lines[q]) && lines[q].trim().split(/\s{2,}/).length > 2) { tabs = lines[q].trim(); question.splice(0, question.indexOf(tabs) + 1); break; }
  }
  const sig = JSON.stringify([question, options.map(o => o.label)]);
  return { question, tabs, options, multi, more, sig };
}
