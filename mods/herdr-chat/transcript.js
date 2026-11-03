// The conversation as rows: folding tool calls and thinking into one line per run, keying rows by
// their content, and drawing messages, tool runs and thinking. The row methods are mixed into the
// chat's View (main.js), so `this` is the view.
import { div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { COLUMN, icon, mono } from "./ui.js";

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

export function foldActivity(messages) {
  const out = [];
  for (const m of messages) {
    if (m.kind !== "tools" && m.kind !== "reasoning") { out.push(m); continue; }
    let group = out[out.length - 1];
    if (group?.kind !== "tools") { group = { kind: "tools", calls: [] }; out.push(group); }
    if (m.kind === "reasoning") group.calls.push({ k: "think", d: "", o: m.text });
    else group.calls.push(...m.calls);
  }
  return out;
}

function outputLines(o) {
  const lines = (o || "").split("\n").filter((l, i, all) => l.trim() || (i > 0 && i < all.length - 1));
  return { shown: lines.slice(0, 6), more: Math.max(0, lines.length - 6) };
}

function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const DIGESTS = new WeakMap();
const CALL_DIGESTS = new WeakMap();
export const CALL_SOURCE = new WeakMap();
const sample = s => s.length > 512 ? `${s.length}:${s.slice(0, 256)}:${s.slice(-256)}` : s;

/** A tool call's digest: its input once per call, plus its output's size and end, which arrive later. */
function callDigest(c) {
  const source = CALL_SOURCE.get(c) ?? c;
  let base = CALL_DIGESTS.get(source);
  if (base === undefined) {
    base = hash(JSON.stringify(source, (k, v) => k === "o" ? undefined : typeof v === "string" ? sample(v) : v));
    CALL_DIGESTS.set(source, base);
  }
  const o = typeof c.o === "string" ? c.o : "";
  return `${base}.${o.length}.${hash(o.slice(-64))}`;
}

/** A row's content digest, computed once per row object: rows are rebuilt, never edited, when their content changes. */
function digest(m) {
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
    const open = Boolean(this.open[i]);
    const kinds = [...new Set(m.calls.map(c => c.k).filter(k => k !== "think"))];
    const glyph = !kinds.length ? "lightbulb" : kinds.length === 1 ? (KINDS[kinds[0]] ?? KINDS.other).icon : "layers";
    const row = v_flex().w_full().child(this.disclosure(i, t, glyph, summary(m.calls), open));
    if (!open) return row;
    return row.child(v_flex().ml(6).mt(4).pl(16).border_l(1).border_color(t.border).gap(0).children(m.calls.map((c, j) => {
      const out = outputLines(c.o);
      return v_flex().w_full().pb(out.shown.length ? 6 : 0)
        .child(h_flex().h(28).gap(10).items_center().min_w(0)
          .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(STEP[c.k] ?? c.k))
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_family(mono()).text_color(t.muted).child(c.d || "")))
        .when(out.shown.length > 0, el => el.child(v_flex().w_full().px(10).py(7).rounded(7).bg(t.surface)
          .font_family(mono()).text_size(12).text_color(t.muted)
          .children(out.shown.map((l, k) => div().id(`o-${i}-${j}-${k}`).h(18).truncate().child(l || " ")))
          .when(out.more > 0, el => el.child(div().h(18).text_color(t.dim).child(`+ ${out.more} more lines`)))));
    })));
  },

  reasoningRow(m, i, t) {
    const open = Boolean(this.open[i]);
    return v_flex().w_full().child(this.disclosure(i, t, "lightbulb", "Thought process", open))
      .when(open, el => el.child(div().ml(6).mt(4).pl(16).border_l(1).border_color(t.border)
        .text_size(13.5).text_color(t.muted).child(TextView.markdown(`think-${i}`, m.text).selectable(true))));
  },

  messageRow(m, i, t) {
    if (m.role === "user") return h_flex().w_full().justify_end()
      .child(div().max_w(Math.min(620, Math.round(Math.min(COLUMN, this.width - 48) * 0.85))).px(16).py(11)
        .rounded(18).bg(t.raised).text_size(15).text_color(t.foreground).child(markdown(`body-${i}`, m.text, t)));
    return div().w_full().text_size(15).text_color(t.foreground).child(markdown(`body-${i}`, m.text, t));
  },

  row(m, i, t) {
    const body = m.kind === "tools" ? this.toolsRow(m, i, t)
      : m.kind === "reasoning" ? this.reasoningRow(m, i, t)
      : m.kind === "note" ? div().w_full().text_size(12.5).text_color(t.dim).child(m.text)
      : this.messageRow(m, i, t);
    return m.turnGap ? v_flex().w_full().pt(TURN_GAP).child(body) : body;
  },
};
