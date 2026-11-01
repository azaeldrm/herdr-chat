import { View, div, svg, image } from "gpui-kit";
import { set_theme, v_flex, h_flex, TextareaState, Textarea, TextView, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { agents, terminals, panes, focused, props, hc, exec, appHome, run, theme, settings, shared } from "herdr";
import { SUPPORTED, ICONS, switchTo } from "./common.js";
import { isHeader, terminalHeader } from "./header.js";

// herdr-chat: any supported agent's terminal as a chat. Each agent writes its own session
// log; read-session.ps1 turns Claude Code, Codex and Pi logs into one shape, drawn here.

const CORAL = "#d97757"; // Claude's accent: the working spark and the send button.
const TURN_GAP = 28;     // extra space where you and the agent take turns
const COLUMN = 740;      // the conversation's width, as on the web
// Herdr's built-in inputs (this message box, the command palette, prompts) paint selected
// text with gpui-base's "accent" token, which herdr fills from the theme's hover color: a gray
// that vanishes on dark backgrounds. Point that one token at the theme's accent instead, kept in
// step with the theme. It is app-wide; herdr's own mods draw from herdr's colors, not this token.
function inputHighlight(cx) {
  // The token takes no alpha, so blend the accent over the surface by hand.
  const t = theme(), th = cx.theme();
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const a = rgb(t.accent), b = rgb(t.surface), k = th.is_dark ? 0.32 : 0.28;
  const want = "#" + a.map((v, i) => Math.round(v * k + b[i] * (1 - k)).toString(16).padStart(2, "0")).join("");
  // Text in the chat is painted under its selection, so that colour must be see-through.
  const see = `${t.accent.slice(0, 7)}${th.is_dark ? "47" : "40"}`;
  // herdr reports colours back without their alpha, so compare the RGB part only. A mismatch
  // here would re-apply forever, and every set_theme restarts every mod copy.
  if (th.colors.accent.slice(0, 7).toLowerCase() === want && th.colors.selection.slice(0, 7).toLowerCase() === see.slice(0, 7).toLowerCase()) return;
  set_theme({ appearance: th.appearance, tokens: { colors: { ...th.colors, accent: want, selection: see }, spacing: th.spacing, radius: th.radius } });
}

const SPARK = ["·", "✢", "✶", "✻", "✽", "✻", "✶", "✢"]; // no ✳: it draws as an emoji

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

function target() {
  const f = focused();
  if (!f) return null;
  const mine = agents().filter(x => x.tab === f.tab && x.space === f.space && SUPPORTED[x.app]);
  const a = mine.find(x => x.address === f.terminal) ?? mine[0];
  if (!a) return null;
  const term = terminals().find(x => x.address === a.address);
  return {
    address: a.address, pane: a.pane, app: a.app, label: SUPPORTED[a.app], program: a.program,
    status: a.status, title: a.title, remote: a.address.includes("/"),
    pid: term?.pid ?? 0, created: term?.created_ms ?? 0, cwd: term?.cwd ?? "",
    activity: term?.report?.msg ?? term?.status?.msg ?? "",
  };
}

// UTF-8 then base64, by hand: the mod runtime doesn't promise TextEncoder or btoa.
function base64Utf8(text) {
  const bytes = [];
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | c >> 6, 0x80 | c & 63);
    else if (c < 0x10000) bytes.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    else bytes.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
  }
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes[i] << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0);
    out += abc[n >> 18 & 63] + abc[n >> 12 & 63] + (i + 1 < bytes.length ? abc[n >> 6 & 63] : "=") + (i + 2 < bytes.length ? abc[n & 63] : "=");
  }
  return out;
}


function icon(name, size, color) { return svg(`${ICONS}/${name}.svg`).size(size).flex_none().text_color(color); }
function mono() { return settings().font_family || settings().font || "JetBrains Mono"; }

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

// A run of thinking and tool calls between two messages becomes one activity row, as on the
// web: thoughts are steps inside it rather than rows of their own.
function foldActivity(messages) {
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

// A row's identity follows its content, not its position: the list caches each row's
// measured height by key, and older rows drop off the top as a session grows.
function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function keyRows(rows) {
  const seen = {};
  for (const m of rows) {
    const base = `${m.kind}-${m.role ?? ""}-${hash(m.text ?? JSON.stringify(m.calls ?? []))}`;
    seen[base] = (seen[base] ?? 0) + 1;
    m.key = `${base}-${seen[base]}`;
  }
  // Extra space where the speaker changes: above the first reply after one of your messages,
  // and above your next message after a reply, so each turn reads as its own block. It is part
  // of the row, so it is measured with it.
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

export default class HerdrChat extends View {
  init(_props, cx) {
    try { this.initInner(cx); }
    catch (e) { this.initError = String(e?.stack ?? e); }
  }

  initInner(cx) {
    // Used as the terminal pane's header, this copy draws only that (see header.js).
    if (isHeader(props())) { this.asHeader = true; this.hovered = false; return; } // not "header": that name is the chat's own top-bar method
    // Wraps, and grows from one row to four as you type; Enter sends, Shift+Enter is a new line.
    this.input = TextareaState.new({ placeholder: "Reply…", rows: 1 });
    this.input.set_soft_wrap(true);
    this.input.set_auto_grow(1, 4);
    this.scroll = VirtualListScrollHandle.new();
    this.input.on("submit", (e, cx) => { if (!e?.shift) this.send(cx); });
    this.input.on("change", (_e, cx) => cx.notify());
    // following: the view keeps to the newest message. Scrolling up turns it off (and shows
    // the jump button); reaching the bottom, sending, or the jump button turns it back on.
    this.following = true; this.visibleEnd = 0; this.rowCount = 0;
    this.messages = []; this.open = {};
    this.width = 900; this.scrollAttempts = 0;
    this.heights = {}; this.measuredAt = 0;
    this.visit = shared("herdr-chat.visit");
    this.path = ""; this.hint = ""; this.note = "Loading conversation…"; this.screen = "";
    this.refresh(cx);
    // Not at start-up: set_theme restarts every copy, which would start this one again.
    cx.timer.every(1500, cx => { inputHighlight(cx); this.refresh(cx); });
    cx.timer.every(100, cx => {
      const visit = shared("herdr-chat.visit");
      if (visit !== this.visit) { this.visit = visit; this.follow(); }
      // Repeated while freshly measured rows settle their heights.
      if (this.scrollAttempts > 0) { this.scroll.scroll_to_bottom(); this.scrollAttempts--; cx.notify(); return; }
      const atBottom = this.rowCount === 0 || this.visibleEnd >= this.rowCount;
      if (atBottom !== this.following) { this.following = atBottom; cx.notify(); }
    });
  }

  follow() { this.following = true; this.scrollAttempts = 15; }

  refresh(cx) {
    const t = target();
    const key = t ? `${t.address}:${t.created}:${t.app}` : "";
    if (key !== this.key) {
      this.key = key; this.following = true; this.scrollAttempts = 15; this.path = ""; this.hint = ""; this.messages = []; this.open = {}; this.screen = ""; this.lastId = "";
      this.note = !t ? "Select a Claude Code, Codex or Pi terminal to see it as a chat."
        : t.remote ? `Chat view reads sessions on this computer only; ${t.label} is running on another machine.`
        : `Finding this ${t.label} conversation…`;
      cx.notify();
    }
    if (!t || t.remote || this.loading) return;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const script = `${appHome()}\\mods\\herdr-chat\\read-session.ps1`;
        const r = await exec("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
          "-App", t.app, "-TermPid", String(t.pid), "-CreatedMs", String(t.created), "-Cwd", t.cwd,
          "-KnownPath", this.path || "", "-Hint", this.hint || ""]);
        if (this.key !== key) return;
        if (r.code !== 0) throw new Error(r.stderr || `Reader exited ${r.code}`);
        let path = "", note = "", hint = "";
        const messages = [];
        for (const line of r.stdout.split(/\r?\n/)) {
          const bar = line.indexOf("|"), tag = line.slice(0, bar), rest = line.slice(bar + 1);
          if (tag === "PATH") path = decodeURIComponent(rest);
          else if (tag === "HINT") hint = decodeURIComponent(rest);
          else if (tag === "NOTE") note = decodeURIComponent(rest);
          else if (tag === "R") messages.push({ kind: "reasoning", text: decodeURIComponent(rest) });
          else if (tag === "T") messages.push({ kind: "tools", calls: JSON.parse(decodeURIComponent(rest)) });
          else if (tag === "M") {
            const [role, phase, ...text] = rest.split("|");
            messages.push({ kind: "message", role, phase, text: decodeURIComponent(text.join("|")) });
          }
        }
        // Codex sessions stay put; Claude Code and Pi can start a new one in the same terminal.
        this.path = t.app === "codex" ? path : "";
        this.hint = hint;
        this.messages = foldActivity(messages);
        this.clipped = note.startsWith("Showing the recent part");
        this.note = this.clipped ? "" : note;
        const last = messages[messages.length - 1];
        const id = last ? `${messages.length}:${last.kind}:${last.text ?? last.calls.length}` : "";
        if (id !== this.lastId) { this.lastId = id; if (this.following) this.follow(); }
        if (t.status === "blocked") {
          const screen = await hc(["read", t.address, "--lines", "26"]);
          this.screen = screen.code === 0 ? screen.stdout.trim().slice(-4000) : "";
        } else this.screen = "";
      } catch (e) { this.note = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  send(cx) {
    const t = target(), message = this.input.value().trim();
    if (!t || t.remote || !message || this.sending) return;
    this.sending = true; cx.notify();
    cx.spawn(async cx => {
      try {
        if (t.status === "blocked" && !(await this.promptStillCurrent(t))) throw new Error("The prompt changed. Review it again before answering.");
        // Through send.ps1, which sends as you: hc would otherwise wrap the text in
        // <hc from="tN"> when the app itself was started from inside a terminal.
        const r = await exec("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
          `${appHome()}\\mods\\herdr-chat\\send.ps1`, "-Address", t.address, "-Text64", base64Utf8(message),
          ...(t.status === "blocked" ? ["-Force"] : [])]);
        if (r.code !== 0) throw new Error(r.stderr || "Send failed");
        if (this.key?.startsWith(`${t.address}:`)) this.input.set_value("");
        this.follow();
      } catch (e) { this.note = String(e); }
      finally { this.sending = false; cx.notify(); }
    });
  }

  async promptStillCurrent(t) {
    if (!this.screen || target()?.address !== t.address || target()?.status !== "blocked") return false;
    const read = await hc(["read", t.address, "--lines", "26"]);
    return read.code === 0 && read.stdout.trim().slice(-4000) === this.screen;
  }

  press(key, cx) {
    const t = target();
    if (!t || this.sending) return;
    this.sending = true; cx.notify();
    cx.spawn(async cx => {
      try {
        if (key !== "esc" && !(await this.promptStillCurrent(t))) throw new Error("The prompt changed. Review it again before answering.");
        const r = await hc(["keys", t.address, key]);
        if (r.code !== 0) throw new Error(r.stderr || "Key send failed");
      } catch (e) { this.note = String(e); }
      finally { this.sending = false; cx.notify(); }
    });
  }

  // --- rows ----------------------------------------------------------------------

  disclosure(i, t, glyph, title, open) {
    return h_flex().h(30).gap(8).items_center().text_size(13.5).text_color(open ? t.foreground : t.muted)
      .child(icon(glyph, 14, t.muted))
      .child(div().flex_shrink(1).min_w(0).truncate().child(title))
      .child(icon(open ? "chevron-down" : "chevron-right", 13, t.dim));
  }

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
  }

  reasoningRow(m, i, t) {
    const open = Boolean(this.open[i]);
    return v_flex().w_full().child(this.disclosure(i, t, "lightbulb", "Thought process", open))
      .when(open, el => el.child(div().ml(6).mt(4).pl(16).border_l(1).border_color(t.border)
        .text_size(13.5).text_color(t.muted).child(TextView.markdown(`think-${i}`, m.text).selectable(true))));
  }

  messageRow(m, i, t) {
    if (m.role === "user") return h_flex().w_full().justify_end()
      .child(div().max_w(Math.min(620, Math.round(Math.min(COLUMN, this.width - 48) * 0.85))).px(16).py(11)
        .rounded(18).bg(t.raised).text_size(15).text_color(t.foreground).child(markdown(`body-${i}`, m.text, t)));
    return div().w_full().text_size(15).text_color(t.foreground).child(markdown(`body-${i}`, m.text, t));
  }

  row(m, i, t) {
    const body = m.kind === "tools" ? this.toolsRow(m, i, t)
      : m.kind === "reasoning" ? this.reasoningRow(m, i, t)
      : m.kind === "note" ? div().w_full().text_size(12.5).text_color(t.dim).child(m.text)
      : this.messageRow(m, i, t);
    return m.turnGap ? v_flex().w_full().pt(TURN_GAP).child(body) : body;
  }

  // --- frame ---------------------------------------------------------------------

  header(t, active) {
    const program = active?.program;
    const glyph = program?.icon
      ? (program.tint ? svg(program.icon).size(15).flex_none().text_color(t.muted) : image(program.icon).size(15).flex_none())
      : null;
    const segment = (id, label, selected, action) => div().id(id).px(10).h(24).flex().items_center().rounded(6)
      .text_size(12.5).text_color(selected ? t.foreground : t.muted).when(selected, el => el.bg(t.selected))
      .when(!selected, el => el.cursor_pointer().hover(s => s.text_color(t.foreground)).on_click(action))
      .child(label);
    // The same pane buttons the terminal header shows on hover, acting on the agent's pane.
    const pane = active?.pane, zoomed = Boolean(pane && panes().find(p => p.pane === pane)?.zoomed);
    const paneButton = (id, glyph, command, args) => div().id(id).p(3).rounded(4).flex_none().cursor_pointer()
      .text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); run(command, args); })
      .child(svg(`${ICONS}/${glyph}.svg`).size(14));
    return h_flex().id("chat-header").h(42).px(14).gap(9).items_center().flex_none()
      .on_hover((hovered, cx) => { if (this.headerHovered !== hovered) { this.headerHovered = hovered; cx.notify(); } })
      .when(Boolean(glyph), el => el.child(glyph))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.muted).child(active?.title || active?.label || ""))
      .when(this.clipped, el => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child("Recent history")))
      .when(Boolean(this.headerHovered && pane), el => el
        .child(paneButton("chat-split-right", "split-right", "pane.split", { direction: "right", pane }))
        .child(paneButton("chat-split-down", "split-down", "pane.split", { direction: "down", pane }))
        .child(paneButton("chat-zoom", zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(paneButton("chat-close", "close", "pane.close", { pane })))
      .when(active?.status === "working", el => el.child(svg(`${ICONS}/spinner.svg`).size(12).flex_none().text_color(t.working).spin(900)))
      .when(active?.status === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(active?.status === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .child(h_flex().flex_none().p(2).gap(2).rounded(8).bg(t.surface).border_1().border_color(t.border)
        .child(segment("view-chat", "Chat", true, null))
        .child(segment("view-terminal", "Terminal", false, () => switchTo("terminal"))));
  }

  status(t, active) {
    if (active?.status === "blocked") {
      const key = (id, label, k) => div().id(id).h(30).px(12).flex().items_center().rounded(8).cursor_pointer()
        .border_1().border_color(t.border).bg(t.background).text_size(12.5).text_color(t.foreground)
        .hover(s => s.bg(t.hover)).on_click((_e, cx) => k === "terminal" ? switchTo("terminal") : this.press(k, cx)).child(label);
      return v_flex().w_full().max_w(COLUMN).p(14).gap(10).rounded(14).border_1().border_color(t.blocked).bg(t.surface)
        .child(h_flex().gap(8).items_center()
          .child(div().size(8).rounded(4).bg(t.blocked))
          .child(div().text_size(13.5).font_semibold().text_color(t.foreground).child(`${active.label} needs your input`)))
        .child(div().max_h(220).overflow_y_scrollbar().px(10).py(8).rounded(8).bg(t.background)
          .font_family(mono()).text_size(12).text_color(t.muted).child(this.screen || "Open the terminal to review the request."))
        .child(h_flex().gap(6).flex_wrap()
          .child(key("k-up", "↑", "up")).child(key("k-down", "↓", "down"))
          .child(key("k-enter", "Enter", "enter")).child(key("k-esc", "Esc", "esc"))
          .child(div().flex_1())
          .child(key("k-term", "Open terminal", "terminal")));
    }
    if (active?.status === "working") return h_flex().w_full().max_w(COLUMN).h(26).gap(8).items_center()
      .child(div().w(14).text_size(15).text_color(CORAL).frames(SPARK, 120).child(SPARK[0]))
      .child(div().flex_1().min_w(0).truncate().text_size(13.5).text_color(t.muted)
        .loop("opacity", { from: 0.55, to: 1, period: 1600 }).child(active.activity ? `${active.activity}…`.replace(/……$/, "…") : "Working…"));
    return null;
  }

  composer(t, active) {
    const ready = Boolean(this.input.value().trim()) && !this.sending && active && !active.remote;
    return v_flex().w_full().max_w(COLUMN).gap(6)
      .child(h_flex().w_full().pl(16).pr(8).py(8).gap(8).items_end().rounded(18).border_1().border_color(t.input).bg(t.surface)
        .child(div().id("composer-input").flex_1().min_w(0).py(4)
          .on_key_down((e, cx) => {
            if (e.key !== "enter" || e.modifiers.shift || e.modifiers.alt) return;
            cx.stop_propagation();
            this.send(cx);
          })
          .child(Textarea.new(this.input).w_full().text_size(15).text_color(t.foreground)))
        .child(div().id("send").size(32).flex_none().flex().items_center().justify_center().rounded(16)
          .bg(ready ? CORAL : t.raised).text_color(ready ? "#ffffff" : t.dim)
          .when(ready, el => el.cursor_pointer().hover(s => s.opacity(0.88)).on_click((_e, cx) => this.send(cx)))
          .child(svg(`${ICONS}/arrow-up.svg`).size(16))))
      .child(div().w_full().text_center().text_size(11.5).text_color(t.dim)
        .child(active ? `Sends to the live ${active.label} terminal` : ""));
  }

  render(cx) {
    if (this.initError) return div().p(20).text_color("#ff6666").child(`herdr-chat init error: ${this.initError}`);
    try { return this.renderInner(cx); }
    catch (e) { return div().p(20).text_color("#ff6666").child(`herdr-chat render error: ${e?.stack ?? e}`); }
  }

  renderInner() {
    if (this.asHeader) return terminalHeader(this);
    const t = theme();
    const active = target();
    const rows = this.messages.slice();
    if (this.note) rows.push({ kind: "note", text: this.note });
    const empty = rows.length === 0 || (rows.length === 1 && rows[0].kind === "note" && !this.messages.length);
    keyRows(rows);
    // The virtual list places rows at the heights it is given, and clips what doesn't fit.
    // So each new or changed row is drawn once off-screen at the column's width and its real
    // height recorded; the list then uses exactly that.
    const inner = Math.min(COLUMN, Math.max(280, Math.floor(this.width) - 50));
    if (inner !== this.measuredAt) { this.heights = {}; this.measuredAt = inner; }
    const hkey = m => `${m.key}${this.open[m.key] ? ":open" : ""}`;
    const pending = rows.filter(m => !(hkey(m) in this.heights)).slice(-40);
    const sizes = rows.map(m => (this.heights[hkey(m)] ?? 40) + 16);
    const status = this.status(t, active);
    this.rowCount = rows.length;
    return v_flex().id("herdr-chat-root").relative().size_full().min_h(0).rounded(10).border_1().border_color(t.border)
      .bg(t.background).text_color(t.foreground)
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 8) { this.width = size.width; cx.notify(); } })
      .child(this.header(t, active))
      .when(empty, el => el.child(v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).px(24)
        .child(div().text_size(26).text_color(CORAL).child("✻"))
        .child(div().max_w(420).text_center().text_size(14).text_color(t.muted).child(this.note))))
      .when(!empty, el => el.child(v_flex().relative().flex_1().min_h(0)
        .child(v_virtual_list("herdr-chat-messages", rows.length, sizes, i => rows[i].key, range => {
        this.visibleEnd = range.end; // read by the 100 ms timer: is the newest row on screen?
        const out = [];
        for (let i = range.start; i < range.end; i++)
          out.push(h_flex().w_full().justify_center().px(24).py(8).child(div().w_full().max_w(COLUMN).child(this.row(rows[i], rows[i].key, t))));
        return out;
      }).track_scroll(this.scroll).on_item_click((key, cx) => {
        const kind = rows.find(r => r.key === key)?.kind;
        if (kind === "tools" || kind === "reasoning") { this.open[key] = !this.open[key]; cx.notify(); }
      }).size_full())
        .when(!this.following && this.scrollAttempts === 0, el => el.child(h_flex().absolute().bottom(12).left(0).right(0).justify_center()
          .child(div().id("jump-bottom").size(34).flex().items_center().justify_center().rounded(17).cursor_pointer()
            .bg(t.popover ?? t.surface).border_1().border_color(t.border).shadow_md().text_color(t.foreground)
            .hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { this.follow(); cx.notify(); })
            .child(svg(`${ICONS}/chevron-down.svg`).size(16)))))))
      .when(pending.length > 0, el => el.child(v_flex().id("herdr-chat-measure").absolute().top(0).left(-20000).w(inner)
        .children(pending.map(m => {
          const k = hkey(m);
          return div().id(`measure-${k}`).w(inner).flex_none()
            .on_size_change((size, cx) => {
              if (this.heights[k] !== size.height) { this.heights[k] = size.height; if (this.following && this.scrollAttempts < 4) this.scrollAttempts = 4; cx.notify(); }
            })
            .child(this.row(m, m.key, t));
        }))))
      .child(v_flex().w_full().flex_none().items_center().px(24).pt(44).pb(14).gap(12)
        .when(Boolean(status), el => el.child(status))
        .child(this.composer(t, active)));
  }
}
