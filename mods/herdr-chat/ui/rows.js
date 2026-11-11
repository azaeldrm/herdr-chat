import { div, image } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { COLUMN, icon, mono, disclosure, bubble } from "./primitives.js";
import { tokens } from "../model/runs-with.js";
import { SENT_DIR, previewFile } from "../images.js";
import { KINDS, STEP, summary, stepText } from "../model/transcript.js";
import { diagramFor } from "../diagrams.js";

const TURN_GAP = 28;

function codeBox(id, lang, source, t, copied) {
  // A code block in a box titled with its language; with `copied` set (true once copied), a copy icon sits at the top right.
  const lines = source.replace(/\n$/, "").split("\n");
  return v_flex().id(id).w_full().rounded(10).border_1().border_color(t.border).bg(t.surface).overflow_hidden()
    .child(h_flex().h(30).px(12).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().text_size(11.5).text_color(t.muted).child(lang || "text"))
      .when(copied === true, el => el.child(div().text_size(11.5).text_color(t.muted).child("Copied")))
      .when(copied !== undefined, el => el.child(icon(copied ? "check" : "copy", 14, t.muted))))
    .child(v_flex().px(12).py(8).font_family(mono()).text_size(12.5).text_color(t.foreground)
      .children(lines.map((l, k) => div().id(`${id}-l${k}`).w_full().min_h(18).child(l.replace(/\t/g, "    ") || " "))));
}

function codeRow(m, { t, copied }) {
  // A fenced code block of a reply as a row of its own: clicking it copies the code (see onItemClick in main.js).
  return codeBox(`code-${m.key}`, m.lang, m.text, t, copied === m.key);
}

function toolButton(t, id, glyph, done, busy, tip) {
  // A small icon button under the conversation (a response's copy, a diagram's): bordered, the icon a check once it's done.
  return div().id(id).w(TOOL_BUTTON).h(28).flex_none().flex().items_center().justify_center().rounded(8)
    .border_1().border_color(t.border).hover(s => s.bg(t.raised)).tooltip(busy ? "Copying…" : done ? "Copied" : tip)
    .child(icon(done ? "check" : glyph, 14, done || busy ? t.foreground : t.muted));
}

function copyRow(m, { t, copied }) {
  // The copy button under an agent's response, at the left, or under one of the person's messages, at the right (`prompt`):
  // clicking the row copies it (see onItemClick in main.js). The button shows while the pointer is over its row (or it was
  // just used); its row keeps its height either way, so nothing moves when it appears.
  // A response's turn numbers (m.stats) follow its button, each with its icon: time, output tokens, tokens per second.
  const done = copied === m.key, s = m.stats;
  const stat = (glyph, text, tip) => h_flex().id(`st-${glyph}-${m.key}`).gap(5).items_center().tooltip(tip)
    .child(icon(glyph, 13, t.dim)).child(div().text_size(12).text_color(t.dim).child(text));
  return h_flex().id(`copy-row-${m.key}`).w_full().h(32).gap(14).items_center().when(m.prompt, el => el.justify_end()).when(!m.prompt, el => el.justify_start())
    .opacity(done ? 1 : 0).hover(st => st.opacity(1))
    .child(toolButton(t, `copy-${m.key}`, "copy", done, false, m.prompt ? "Copy your message" : "Copy the response"))
    .when(Boolean(s && !m.prompt), el => el
      .when(s?.secs != null, e => e.child(stat("clock", duration(s.secs), "How long the turn took")))
      .child(stat("hash", `${tokens(s?.out ?? 0)} tokens`, "Tokens the agent wrote this turn (thinking included)"))
      .when(s?.tps != null, e => e.child(stat("activity", `${Math.round(s.tps)}/s`, "Tokens per second while the agent was writing (tool time left out)"))));
}

export function duration(secs) {
  // "8s", "42s", "3m 05s", "1h 02m".
  const n = Math.round(secs);
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, "0")}s`;
  return `${Math.floor(n / 3600)}h ${String(Math.floor(n % 3600 / 60)).padStart(2, "0")}m`;
}

function markdown(id, source, t) {
  // Markdown with each fenced code block in a titled box of its own.
  const parts = source.split(/```([^\n`]*)\n([\s\S]*?)```/g);
  if (parts.length === 1) return TextView.markdown(id, source).selectable(true);
  const blocks = [];
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i]?.trim()) blocks.push(TextView.markdown(`${id}-t${i}`, parts[i].trim()).selectable(true));
    if (i + 2 < parts.length) {
      blocks.push(codeBox(`${id}-c${i}`, parts[i + 1]?.trim(), parts[i + 2], t));
    }
  }
  return v_flex().w_full().gap(12).children(blocks);
}

function toolsRow(m, { t, open }) {
  // A group's title line; opened, its steps follow as rows of their own (stepRows).
  const kinds = [...new Set(m.calls.map(c => c.k).filter(k => k !== "think"))];
  const glyph = !kinds.length ? "brain" : kinds.length === 1 ? (KINDS[kinds[0]] ?? KINDS.other).icon : "layers";
  return v_flex().w_full().child(disclosure(t, glyph, summary(m.calls), Boolean(open[m.key])));
}

function stepRow(m, { t, open: opened }) {
  // One step of an opened group: a thought in full markdown, or a call with its output in a box.
  const i = m.key, c = m.call, open = Boolean(opened[i]), shown = stepText(c, open);
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
}

function sentImage(t, id, path, sent, machine) {
  // An image in the person's message: its preview in sent/, else a chip with its name.
  const name = path.split(/[\\/]/).pop(), preview = previewFile(sent, path, machine);
  if (preview) return div().id(id).size(120).flex_none().rounded(12).overflow_hidden().border_1().border_color(t.border).bg(t.raised)
    .tooltip(name).child(image(`${SENT_DIR}/${preview}`).size_full());
  return h_flex().id(id).h(32).px(10).gap(6).flex_none().items_center().rounded(8).bg(t.raised).text_size(12.5).text_color(t.muted)
    .child(icon("image", 14, t.muted)).child(name || "Pasted image");
}

function messageRow(m, { t, width, sent, machine }) {
  // A message: the person's in a bubble (its images above it), the agent's as plain markdown across the column.
  if (m.role === "user") {
    const room = Math.min(620, Math.round(Math.min(COLUMN, width - 48) * 0.85));
    const text = m.text ? bubble(t, room, markdown(`body-${m.key}`, m.text, t)) : null;
    if (!m.images?.length) return text;
    return v_flex().w_full().gap(8)
      .child(h_flex().w_full().justify_end().flex_wrap().gap(8).children(m.images.map((p, i) => sentImage(t, `img-${m.key}-${i}`, p, sent, machine))))
      .when(Boolean(text), el => el.child(text));
  }
  return div().w_full().text_size(15).text_color(t.foreground).child(markdown(`body-${m.key}`, m.text, t));
}

function diagramRow(m, { t, width }) {
  // A ```mermaid block from a reply, as its own row: the picture alone, in the reply's column; a click opens it larger (openDiagram).
  const d = diagramFor(m.text, t);
  if (d.state === "queued") return div().w_full().h(24).flex().items_center().text_size(12.5).text_color(t.dim).child("Drawing diagram…");
  if (d.state === "failed") return v_flex().w_full().gap(6)
    .child(markdown(`diagram-src-${m.key}`, "```mermaid\n" + m.text + "\n```", t))
    .child(div().text_size(12).text_color(t.dim).child(`Couldn't draw this diagram: ${d.error}`));
  const room = Math.min(COLUMN, Math.max(280, Math.floor(width) - 50));
  const w = Math.min(d.width, room), h = Math.round(d.height * w / d.width);
  return div().id(`diagram-${m.key}`).w_full().cursor_pointer().tooltip("Click to open it larger").child(image(d.rel).w(w).h(h));
}

// The buttons under the conversation, at the left: a response's copy, and a diagram's two (copy the picture, copy the code),
// which main.js tells apart by the pointer's place.
export const TOOL_BUTTON = 30, TOOL_GAP = 6;

function diagramToolsRow(m, { t, copied }) {
  const button = (which, glyph, tip) => toolButton(t, `dt-${which}-${m.key}`, glyph, copied === `${m.key}:${which}`, copied === `${m.key}:${which}:busy`, tip);
  return h_flex().w_full().h(32).gap(TOOL_GAP).items_center().justify_start()
    .child(button("image", "image", "Copy the diagram as a picture"))
    .child(button("code", "copy", "Copy the diagram's mermaid code"));
}

export function row(m, ctx) {
  // One conversation row, drawn from the row alone and `ctx` ({ t, open, width, sent, machine }), with the gap that starts a turn.
  const body = m.kind === "tools" ? toolsRow(m, ctx)
    : m.kind === "step" ? stepRow(m, ctx)
    : m.kind === "note" ? div().w_full().text_size(12.5).text_color(ctx.t.dim).child(m.text)
    : m.kind === "diagram" ? diagramRow(m, ctx)
    : m.kind === "diagram-tools" ? diagramToolsRow(m, ctx)
    : m.kind === "code" ? codeRow(m, ctx)
    : m.kind === "copy" ? copyRow(m, ctx)
    : messageRow(m, ctx);
  return m.turnGap ? v_flex().w_full().pt(TURN_GAP).child(body) : body;
}
