import { div, image } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { COLUMN, icon, mono } from "./ui.js";
import { hash } from "./common.js";
import { diagramFor } from "./diagrams.js";

const TURN_GAP = 28;
const KINDS = {
  shell:  { icon: "terminal",    label: "Ran",     one: "command",  many: "commands" },
  read:   { icon: "file-text",   label: "Read",    one: "file",     many: "files" },
  edit:   { icon: "square-pen",  label: "Edited",  one: "file",     many: "files" },
  search: { icon: "search",      label: "Searched", one: "pattern", many: "patterns" },
  web:    { icon: "globe",       label: "Searched the web", one: "", many: "" },
  image:  { icon: "image",       label: "Viewed",  one: "image",    many: "images" },
  agent:  { icon: "layers",      label: "Ran",     one: "agent",    many: "agents" },
  todo:   { icon: "circle-check", label: "Updated the to-do list", one: "", many: "" },
  other:  { icon: "settings",    label: "Used",    one: "tool",     many: "tools" },
};
const STEP = { think: "Thought", shell: "Bash", read: "Read", edit: "Edit", search: "Search", web: "Web", image: "View", agent: "Agent", todo: "Todos", other: "Tool" };

function summary(steps) {
  const calls = steps.filter(c => c.k !== "think");
  if (!calls.length) return "Thought process";
  const order = [], counts = {}, files = {};
  for (const c of calls) {
    if (!(c.k in counts)) { order.push(c.k); counts[c.k] = 0; files[c.k] = new Set(); }
    counts[c.k]++;
    if (c.k === "edit") for (const f of (c.d || "").split(", ").filter(Boolean)) files.edit.add(f);
  }
  const parts = order.map(k => {
    const kind = KINDS[k] ?? KINDS.other, n = k === "edit" ? Math.max(1, files.edit.size) : counts[k];
    if (!kind.one) return kind.label;
    if (n === 1 && calls.length === 1 && calls[0].d && k !== "shell") return `${kind.label} ${calls[0].d}`;
    return `${kind.label} ${n} ${n === 1 ? kind.one : kind.many}`;
  });
  const text = parts.join(", ");
  return parts.length ? text[0].toUpperCase() + text.slice(1).replace(/, (\w)/g, (_m, c) => `, ${c.toLowerCase()}`) : "";
}

export function withoutRetracted(messages, retracted) {
  // The rows without the message the agent handed back (Claude Code, stopped before answering).
  if (!retracted) return { rows: messages, retracted: null };
  let last = messages.length - 1;
  while (last >= 0 && messages[last].kind !== "message") last--;
  const m = messages[last];
  if (!m || m.role !== "user" || m.text.trim() !== retracted.trim() || last !== messages.length - 1) return { rows: messages, retracted: null };
  return { rows: messages.slice(0, last), retracted };
}

export function foldActivity(messages) {
  // Folds each run of tool calls and thoughts into one group of steps, in order.
  const out = [];
  for (const m of messages) {
    if (m.kind !== "tools" && m.kind !== "reasoning") { out.push(m); continue; }
    if (m.kind === "reasoning" && !m.text?.trim()) continue;
    let group = out[out.length - 1];
    if (group?.kind !== "tools") { group = { kind: "tools", calls: [] }; out.push(group); }
    if (m.kind === "reasoning") group.calls.push({ k: "think", d: "", o: m.text });
    else group.calls.push(...m.calls);
  }
  return out;
}

export const OUTPUT_LINES = 6, OUTPUT_CHARS = 700, THOUGHT_CHARS = 360, THOUGHT_LINES = 4;

export function stepText(c, open) {
  // A step's text: all of it when `open`, else a preview of a few lines, and whether anything was left out.
  const text = (c.o || "").replace(/\s+$/, "").replace(/^\n+/, "");
  if (open || !text) return { text, more: false };
  if (c.k === "think") {
    const lines = text.split("\n");
    if (text.length <= THOUGHT_CHARS && lines.length <= THOUGHT_LINES) return { text, more: false };
    let cut = lines.slice(0, THOUGHT_LINES).join("\n").slice(0, THOUGHT_CHARS);
    const space = cut.lastIndexOf(" ");
    if (space > THOUGHT_CHARS * 0.6) cut = cut.slice(0, space);
    return { text: cut.replace(/[\s,;:.]+$/, "") + " \u2026", more: true };
  }
  const lines = text.split("\n");
  const shown = lines.slice(0, OUTPUT_LINES).join("\n");
  if (lines.length <= OUTPUT_LINES && shown.length <= OUTPUT_CHARS) return { text, more: false };
  return { text: shown.slice(0, OUTPUT_CHARS).replace(/\s+$/, "") + "\n\u2026", more: true, hidden: lines.length - Math.min(lines.length, OUTPUT_LINES) };
}

export function stepRows(group) {
  // An opened group's steps, as rows of their own below its title.
  return group.calls.map((c, j) => ({ kind: "step", call: c, last: j === group.calls.length - 1, key: `${group.key}/${j}.${callDigest(c)}` }));
}

const DIGESTS = new WeakMap();
const CALL_DIGESTS = new WeakMap();
export const CALL_SOURCE = new WeakMap();
const sample = s => s.length > 512 ? `${s.length}:${s.slice(0, 256)}:${s.slice(-256)}` : s;

function callDigest(c) {
  // A tool call's digest: its input once per call, plus its output's size and end, which arrive later.
  const source = CALL_SOURCE.get(c) ?? c;
  let base = CALL_DIGESTS.get(source);
  if (base === undefined) {
    base = hash(JSON.stringify(source, (k, v) => k === "o" ? undefined : typeof v === "string" ? sample(v) : v));
    CALL_DIGESTS.set(source, base);
  }
  const o = typeof c.o === "string" ? c.o : "";
  return `${base}.${o.length}.${hash(o.slice(-64))}`;
}

function digest(m) {
  // A row's content digest, computed once per row object.
  let d = DIGESTS.get(m);
  if (d === undefined) {
    d = m.text != null ? hash(sample(m.text)) : hash((m.calls ?? []).map(callDigest).join("|"));
    DIGESTS.set(m, d);
  }
  return d;
}

export function keyRows(rows) {
  const seen = {};
  for (const m of rows) {
    const base = `${m.kind}-${m.role ?? ""}-${digest(m)}`;
    seen[base] = (seen[base] ?? 0) + 1;
    m.key = `${base}-${seen[base]}`;
  }
  rows.forEach((m, i) => {
    const prev = rows[i - 1], user = m.kind === "message" && m.role === "user";
    const prevUser = prev?.kind === "message" && prev.role === "user";
    m.turnGap = Boolean(prev) && m.kind !== "note" && (user ? !prevUser : prevUser);
    if (m.turnGap) m.key += "-g";
  });
  return rows;
}

function markdown(id, source, t) {
  const parts = source.split(/```([^\n`]*)\n([\s\S]*?)```/g);
  if (parts.length === 1) return TextView.markdown(id, source).selectable(true);
  const blocks = [];
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i]?.trim()) blocks.push(TextView.markdown(`${id}-t${i}`, parts[i].trim()).selectable(true));
    if (i + 2 < parts.length) {
      const lang = parts[i + 1]?.trim();
      blocks.push(v_flex().id(`${id}-c${i}`).w_full().rounded(10).border_1().border_color(t.border).bg(t.surface).overflow_hidden()
        .child(h_flex().h(30).px(12).items_center().border_b(1).border_color(t.border)
          .child(div().text_size(11.5).text_color(t.muted).child(lang || "text")))
        .child(div().px(2).text_size(13).child(TextView.markdown(`${id}-ct${i}`, `\`\`\`${parts[i + 1] || ""}\n${parts[i + 2]}\n\`\`\``).selectable(true))));
    }
  }
  return v_flex().w_full().gap(12).children(blocks);
}

export const TranscriptMethods = {
  disclosure(i, t, glyph, title, open) {
    return h_flex().h(30).gap(8).items_center().text_size(13.5).text_color(open ? t.foreground : t.muted)
      .child(icon(glyph, 14, t.muted))
      .child(div().flex_shrink(1).min_w(0).truncate().child(title))
      .child(icon(open ? "chevron-down" : "chevron-right", 13, t.dim));
  },

  toolsRow(m, i, t) {
    // A group's title line; opened, its steps follow as rows of their own (stepRows).
    const kinds = [...new Set(m.calls.map(c => c.k).filter(k => k !== "think"))];
    const glyph = !kinds.length ? "brain" : kinds.length === 1 ? (KINDS[kinds[0]] ?? KINDS.other).icon : "layers";
    return v_flex().w_full().child(this.disclosure(i, t, glyph, summary(m.calls), Boolean(this.open[i])));
  },

  stepRow(m, i, t) {
    // One step of an opened group: a thought in full markdown, or a call with its output in a box.
    const c = m.call, open = Boolean(this.open[i]), shown = stepText(c, open);
    const toggle = shown.more || open && stepText(c, false).more;
    const body = !shown.text ? null
      : c.k === "think" ? div().w_full().pb(4).child(TextView.markdown(`think-${i}`, shown.text).selectable(true).text_size(13).text_color(t.muted))
      : v_flex().w_full().px(10).py(7).rounded(7).bg(t.surface).font_family(mono()).text_size(12).text_color(t.muted)
        .children(shown.text.split("\n").map((l, k) => div().id(`o-${i}-${k}`).w_full().min_h(18).child(l || " ")));
    return v_flex().w_full().ml(6).pl(16).border_l(1).border_color(t.border).pb(m.last ? 6 : 2)
      .child(h_flex().h(28).gap(10).items_center().min_w(0)
        .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(STEP[c.k] ?? c.k))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_family(mono()).text_color(t.muted).child(c.d || ""))
        .when(toggle, el => el.child(h_flex().flex_none().gap(4).items_center().text_size(12).text_color(t.dim)
          .child(open ? "Show less" : shown.hidden ? `${shown.hidden} more lines` : "Show all")
          .child(icon(open ? "chevron-down" : "chevron-right", 12, t.dim)))))
      .when(body, el => el.child(body));
  },

  messageRow(m, i, t) {
    if (m.role === "user") return h_flex().w_full().justify_end()
      .child(div().max_w(Math.min(620, Math.round(Math.min(COLUMN, this.width - 48) * 0.85))).px(16).py(11)
        .rounded(18).bg(t.raised).text_size(15).text_color(t.foreground).child(markdown(`body-${i}`, m.text, t)));
    return div().w_full().text_size(15).text_color(t.foreground).child(markdown(`body-${i}`, m.text, t));
  },

  diagramRow(m, i, t) {
    // A ```mermaid block from a reply, as its own row: the picture alone, in the reply's column.
    const d = diagramFor(m.text, t);
    if (d.state === "queued") return div().w_full().h(24).flex().items_center().text_size(12.5).text_color(t.dim).child("Drawing diagram…");
    if (d.state === "failed") return v_flex().w_full().gap(6)
      .child(markdown(`diagram-src-${i}`, "```mermaid\n" + m.text + "\n```", t))
      .child(div().text_size(12).text_color(t.dim).child(`Couldn't draw this diagram: ${d.error}`));
    const room = Math.min(COLUMN, Math.max(280, Math.floor(this.width) - 50));
    const w = Math.min(d.width, room), h = Math.round(d.height * w / d.width);
    return div().w_full().child(image(d.rel).w(w).h(h));
  },

  row(m, i, t) {
    const body = m.kind === "tools" ? this.toolsRow(m, i, t)
      : m.kind === "step" ? this.stepRow(m, i, t)
      : m.kind === "note" ? div().w_full().text_size(12.5).text_color(t.dim).child(m.text)
      : m.kind === "diagram" ? this.diagramRow(m, i, t)
      : this.messageRow(m, i, t);
    return m.turnGap ? v_flex().w_full().pt(TURN_GAP).child(body) : body;
  },
};
