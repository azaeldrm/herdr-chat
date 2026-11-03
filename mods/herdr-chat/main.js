import { View, div, svg, image } from "gpui-kit";
import { set_theme, v_flex, h_flex, TextareaState, Textarea, TextView, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { agents, terminals, panes, focused, props, hc, exec, appHome, run, theme, settings, shared, setShared, watchFolder } from "herdr";
import { readFile } from "fs/promises";
import { SUPPORTED, ICONS, switchTo, showView, preferredView } from "./common.js";
import { isHeader, terminalHeader } from "./header.js";

const TURN_GAP = 28;
const COLUMN = 740;
// Room under the newest message, inside the list, so older text can scroll right up to the
// reply box instead of stopping at a padded band above it.
const TAIL = 32;
// How far above the reply box messages fade out as they scroll under it.
const FADE = 20;
const SESSIONS_KEPT = 12;
const PATHS_KEY = "herdr-chat.paths";
function inputHighlight(cx) {
  const t = theme(), th = cx.theme();
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const a = rgb(t.accent), b = rgb(t.surface), k = th.is_dark ? 0.32 : 0.28;
  const want = "#" + a.map((v, i) => Math.round(v * k + b[i] * (1 - k)).toString(16).padStart(2, "0")).join("");
  const see = `${t.accent.slice(0, 7)}${th.is_dark ? "47" : "40"}`;
  if (th.colors.accent.slice(0, 7).toLowerCase() === want && th.colors.selection.slice(0, 7).toLowerCase() === see.slice(0, 7).toLowerCase()) return;
  set_theme({ appearance: th.appearance, tokens: { colors: { ...th.colors, accent: want, selection: see }, spacing: th.spacing, radius: th.radius } });
}

const SPARK = ["·", "✢", "✶", "✻", "✽", "✻", "✶", "✢"];

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
    machine: a.address.includes("/") ? a.address.split("/")[0] : null,
    pid: term?.pid ?? 0, created: term?.created_ms ?? 0, cwd: term?.cwd ?? "",
    activity: term?.report?.msg ?? term?.status?.msg ?? "",
  };
}

function onWindows() { return appHome().includes("\\"); }

// Images attached in the reply box. Each gets a short-lived preview copy in the herdr
// home (image() draws only from there), deleted once it's sent or removed. On send,
// `hc put` places the image beside the agent's terminal, here or on another machine,
// in a folder herdr-core removes with that terminal; the message names that copy.
const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;
const ATTACH_DIR = "cache/herdr-chat";
function attachDir() { return onWindows() ? `${appHome()}\\cache\\herdr-chat` : `${appHome()}/${ATTACH_DIR}`; }
function modFile(name) { return onWindows() ? `${appHome()}\\mods\\herdr-chat\\${name}` : `${appHome()}/mods/herdr-chat/${name}`; }
function psQuote(s) { return `'${String(s).replace(/'/g, "''")}'`; }
/** A unique name for the preview copy, without its extension (the prepare script picks it). */
function attachName(source) {
  const base = source.split(/[\\/]/).pop().replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "-").slice(-40) || "image";
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}-${base}`;
}
// How a message carries an image, per agent (each checked in its session log):
// - Claude Code attaches an @-mentioned image file to the message, up to about 256 KB
//   (why the prepare scripts shrink bigger ones).
// - Codex attaches a pasted path only when the paste holds nothing else, so each path is
//   pasted first without Enter (input-box.py paste), then the text is sent. Windows has no pty
//   for that, so there Codex gets the plain path and opens it with its view_image tool.
// - Pi never attaches: its own Ctrl+V saves the image and inserts the path as text, and the
//   model reads it with its read tool. The plain path is Pi's native form.
const ATTACH_STYLE = { "claude-code": "mention", codex: "paste", pi: "path" };
/**
 * The agent's box read back into the chat's draft. `m` is what the chat last put there: its images
 * (`images`, `paths` as placed beside the terminal), what it pasted for the text (`pasted`) and what
 * that became in the box (`textBox`: a long paste folds into a placeholder). Returns the text, the
 * chat's images still in the box, and whether an image pasted in the terminal itself is there.
 */
function readBack(app, box, m) {
  let s = box;
  if (m && m.textBox && m.textBox !== m.pasted && s.includes(m.textBox)) s = s.replace(m.textBox, m.pasted);
  const kept = [];
  let foreign = false;
  const ours = i => (m && i >= 0 && i < m.images.length ? m.images[i] : null);
  if (app === "codex") {
    s = s.replace(/\[Image #(\d+)\]\s?/g, (all, k) => { const a = ours(Number(k) - 1); if (a) { kept.push(a); return ""; } foreign = true; return all; });
  } else if (app === "claude-code") {
    s = s.replace(/@"([^"]+)"\s?|@(\S+)\s?/g, (all, quoted, bare) => { const a = ours(m ? m.paths.indexOf(quoted ?? bare) : -1); if (a) { kept.push(a); return ""; } return all; });
    if (/\[Image #\d+\]/.test(s)) foreign = true;
  } else if (m) {
    m.paths.forEach((path, i) => { if (s.includes(path)) { kept.push(m.images[i]); s = s.replace(path, "").replace(/^\s+/, ""); } });
  }
  return { text: s.replace(/^\s+/, ""), kept, foreign };
}

// The agents whose input box input-box.py can read and set (it needs a pty: not on Windows).
const DRAFT_MIRROR = { "claude-code": true, codex: true, pi: true };
function attachStyle(app) {
  const style = ATTACH_STYLE[app] ?? "path";
  return style === "paste" && onWindows() ? "path" : style;
}
function withImages(app, paths, text) {
  if (!paths.length) return text;
  const style = attachStyle(app);
  if (style === "paste") return text;
  const refs = paths.map(p => style === "mention" ? (/\s/.test(p) ? `@"${p}"` : `@${p}`) : p);
  return [refs.join(" "), text].filter(Boolean).join(" ");
}

let pythonBoot = null;
async function runReader(t, { path, hint, offset, screen, peers, leaf }) {
  if (!t.remote && onWindows()) {
    return exec("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      `${appHome()}\\mods\\herdr-chat\\read-session.ps1`,
      "-App", t.app, "-TermPid", String(t.pid), "-CreatedMs", String(t.created), "-Cwd", t.cwd,
      "-KnownPath", path || "", "-Hint", hint || "", "-Offset", String(offset || 0), "-Leaf", leaf || ""]);
  }
  if (!pythonBoot) {
    const source = await readFile(`${appHome()}/mods/herdr-chat/read_session.py`, "utf8");
    pythonBoot = `import base64,sys;sys.argv[0]='read_session';exec(compile(base64.b64decode('${base64Utf8(source)}'),'read_session.py','exec'))`;
  }
  const args = ["--app", t.app, "--pid", String(t.pid), "--created", String(t.created), "--offset", String(offset || 0)];
  if (screen) args.push("--screen", screen);
  if (peers) args.push("--peers", String(peers));
  if (t.cwd) args.push("--cwd", t.cwd);
  if (path) args.push("--known", path);
  if (hint) args.push("--hint", hint);
  if (leaf) args.push("--leaf", leaf);
  return exec("python3", ["-c", pythonBoot, ...args], t.machine ? { on: t.machine } : undefined);
}

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

function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const DIGESTS = new WeakMap();
const CALL_DIGESTS = new WeakMap();
const CALL_SOURCE = new WeakMap();
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

function keyRows(rows) {
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

export default class HerdrChat extends View {
  init(_props, cx) {
    try { this.initInner(cx); }
    catch (e) { this.initError = String(e?.stack ?? e); }
  }

  initInner(cx) {
    if (isHeader(props())) { this.asHeader = true; this.hovered = false; return; }
    this.input = TextareaState.new({ placeholder: "Reply…", rows: 1 });
    this.input.set_soft_wrap(true);
    this.input.set_auto_grow(1, 4);
    this.scroll = VirtualListScrollHandle.new();
    this.input.on("submit", (e, cx) => { if (!e?.shift) this.enter(cx); });
    this.input.on("change", (_e, cx) => {
      // The textarea's own Enter adds a line whether or not the chat's handler ran first: a line it
      // added just after an Enter that sent goes again, so Enter only ever sends.
      if (Date.now() - (this.enterAt ?? 0) < 400) {
        const v = this.input.value(), s = v.replace(/\r?\n$/, "");
        if (s !== v) this.input.set_value(s);
      }
      cx.notify();
    });
    // A paste with no text in it (an image) that didn't come through Ctrl+V below: right-click, say.
    this.input.on("paste_other", (_e, cx) => { if (Date.now() - (this.imagePasteAt ?? 0) > 800) this.pasteImage(cx); });
    this.following = true; this.visibleEnd = 0; this.rowCount = 0;
    this.messages = []; this.open = {};
    this.width = 900; this.needsScroll = true; this.scrollAskedAt = Date.now(); this.lastAsk = Date.now(); this.laidOut = 0; this.pendingCount = -1; this.settling = true; this.isEmpty = true;
    this.heights = {}; this.changedAt = {}; this.measuredAt = 0;
    this.attachments = []; // { name, file (absolute preview copy), rel (for image()) }
    // The draft mirror: what the chat box and the agent's own input box last agreed on.
    this.mirror = null; // { session: "address:created", text, box (as the agent draws it) }
    this.lastMode = shared("herdr-chat.mode"); this.lastModeSession = "";
    this.mirrorChain = Promise.resolve();
    this.pruneCache();
    this.visit = shared("herdr-chat.visit");
    this.path = ""; this.hint = ""; this.note = "Loading conversation…"; this.screen = "";
    this.raw = []; this.calls = new Map(); this.offset = 0; this.leaf = ""; this.lastRead = 0; this.sessions = new Map();
    this.refresh(cx);
    cx.timer.every(1500, cx => { inputHighlight(cx); this.refresh(cx); });
    cx.timer.every(100, cx => {
      this.applyView();
      this.mirrorOnSwitch(cx);
      const t = target();
      if ((t ? `${t.address}:${t.created}:${t.app}` : "") !== this.key) this.refresh(cx);
      this.noticeVisit();
      if (shared("herdr-chat.mode") !== "chat") return;
      if (this.following && this.needsScroll) {
        const drawn = (this.laidOut ?? 0) >= this.lastAsk;
        if (drawn && (this.pendingCount === 0 || Date.now() - this.scrollAskedAt > 1500)) {
          this.needsScroll = false;
          this.settledSig = this.sig;
          if (!this.isEmpty) this.settling = false;
          this.scroll.scroll_to_bottom();
        }
        cx.notify();
        return;
      }
      if (this.settling) { if (!this.isEmpty) this.follow(); return; }
      const atBottom = this.isEmpty || this.rowCount === 0 || this.visibleEnd >= this.rowCount;
      if (atBottom !== this.following) { this.following = atBottom; cx.notify(); }
    });
  }

  /**
   * The chat box and the agent's own input box hold the same draft. Switching this agent's pane to
   * the terminal types the chat's draft into the agent's box (an empty one empties it); switching back
   * reads the box into the chat. A switch that also changes agent, tab or space carries nothing.
   */
  mirrorOnSwitch(cx) {
    const mode = shared("herdr-chat.mode"), t = target();
    const session = t ? `${t.address}:${t.created}` : "";
    const was = this.lastMode, wasSession = this.lastModeSession;
    this.lastMode = mode; this.lastModeSession = session;
    // The keyboard follows the view: otherwise the hidden terminal keeps it, and Ctrl+V there pastes
    // an image into the agent's own box (herdr's terminal.paste_image) instead of the chat.
    if (mode === "chat" && was !== "chat") this.input.focus();
    if (mode === was || !t || session !== wasSession || !DRAFT_MIRROR[t.app] || onWindows() || this.sending) return;
    if (was === "chat" && mode === "terminal") this.pushDraft(t, session, cx);
    else if (was === "terminal" && mode === "chat") this.pullDraft(t, session, cx);
  }

  /** One mirror step at a time: a quick switch back waits for the push before reading the box. */
  queueMirror(cx, step) {
    this.mirrorChain = this.mirrorChain.then(() => new Promise(done => cx.spawn(async cx => {
      try { await step(cx); } catch {} finally { done(); }
    })));
  }

  /**
   * The chat's draft as the agent's own box shows it: each attached image in the agent's native form,
   * then the text. Claude Code: `@path` mentions, which it attaches when the message is sent. Codex:
   * each path pasted alone, which it shows as [Image #N]. Pi: plain paths, as its own paste leaves.
   */
  draftPastes(app, paths, text) {
    if (app === "codex") return { pastes: [...paths, text], pasted: text };
    const refs = paths.map(p => app === "claude-code" ? (/\s/.test(p) ? `@"${p}"` : `@${p}`) : p);
    const pasted = [refs.join(" "), text].filter(Boolean).join(" ");
    return { pastes: [pasted], pasted };
  }

  pushDraft(t, session, cx) {
    const text = this.input.value(), images = this.attachments.slice();
    const sig = `${text}\u0000${images.map(a => a.file).join("|")}`;
    if (this.mirror?.session === session && this.mirror.sig === sig) return;
    this.queueMirror(cx, async () => {
      const paths = await this.placeImages(t, images);
      const { pastes, pasted } = this.draftPastes(t.app, paths, text);
      const r = await exec("python3", ["-I", modFile("input-box.py"), "set", t.address, t.app, JSON.stringify(pastes)]);
      if (r.code !== 0) return;
      const box = JSON.parse(r.stdout).box ?? "";
      // what the text became in the box (a long paste folds into a placeholder), images left out
      const textBox = t.app === "codex" ? box.replace(/\[Image #\d+\]\s?/g, "").trim() : box;
      this.mirror = { session, sig, images, paths, pasted, textBox, box, foreign: false };
    });
  }

  /**
   * The agent's box back into the chat: the placeholder a long paste became turns back into the text,
   * and the chat's own images (its @mentions, its [Image #N], its paths) back into thumbnails. An image
   * pasted in the terminal itself can't come back (the agent keeps it), so then the draft stays there.
   */
  pullDraft(t, session, cx) {
    this.queueMirror(cx, async cx => {
      const r = await exec("python3", ["-I", modFile("input-box.py"), "read", t.address, t.app]);
      if (r.code !== 0) return;
      const box = JSON.parse(r.stdout).box;
      if (box == null || target()?.address !== t.address || shared("herdr-chat.mode") !== "chat") return;
      const m = this.mirror?.session === session ? this.mirror : null;
      if (m && box === m.box) return; // nothing changed in the terminal (a pasted image there stays flagged)
      const { text, kept, foreign } = readBack(t.app, box, m);
      if (foreign) {
        this.mirror = { ...(m ?? { session, sig: "", images: [], paths: [], pasted: "", textBox: "" }), box, foreign: true };
        this.note = `${t.label}'s input box has an image that was pasted into the terminal itself, and ${t.label} keeps that image where the chat can't read it. Send that draft from the Terminal view, or remove the image there.`;
        cx.notify();
        return;
      }
      const dropped = this.attachments.filter(a => m?.images.includes(a) && !kept.includes(a));
      this.forget(dropped.map(a => a.file));
      this.attachments = [...new Set([...kept, ...this.attachments.filter(a => !m?.images.includes(a))])];
      if (text !== this.input.value()) this.input.set_value(text);
      const sig = `${text}\u0000${this.attachments.map(a => a.file).join("|")}`;
      this.mirror = { ...(m ?? { session, images: [], paths: [], pasted: "", textBox: "" }), session, sig, box, foreign: false };
      cx.notify();
    });
  }

  applyView() {
    const f = focused(), t = target();
    const focus = `${f?.space ?? ""}:${f?.tab ?? ""}:${t ? `${t.address}:${t.created}` : "-"}`;
    if (focus === this.viewFocus) return;
    this.viewFocus = focus;
    showView(t ? preferredView(`${t.address}:${t.created}`) : "terminal");
  }

  /**
   * Keeps the chat at its newest message: one scroll, once the list has been drawn since this was asked
   * and what's on screen has its final heights (or 1.5 s have passed), not a scroll per tick.
   */
  follow(restart = false) {
    this.following = true;
    this.lastAsk = Date.now();
    if (!this.needsScroll || restart) { this.needsScroll = true; this.scrollAskedAt = Date.now(); }
  }

  /** A switch to Chat: back to the newest message, hidden until it lands unless nothing changed since it last did. */
  noticeVisit() {
    const visit = shared("herdr-chat.visit");
    if (visit === this.visit) return;
    this.visit = visit;
    if (this.sig !== this.settledSig) this.settling = true;
    this.follow(true);
  }

  stash() {
    if (!this.key || !this.path) return;
    const { raw, calls, offset, leaf, path, hint, messages, clipped, note, open } = this;
    this.sessions.delete(this.key);
    this.sessions.set(this.key, { raw, calls, offset, leaf, path, hint, messages, clipped, note, open });
    while (this.sessions.size > SESSIONS_KEPT) this.sessions.delete(this.sessions.keys().next().value);
  }

  rememberPath(path) {
    const t = target();
    if (!t) return;
    const all = { ...(shared(PATHS_KEY) ?? {}) }, id = `${t.address}:${t.created}`;
    delete all[id];
    all[id] = { path, hint: this.hint || "" };
    const ids = Object.keys(all);
    for (const old of ids.slice(0, Math.max(0, ids.length - 200))) delete all[old];
    setShared(PATHS_KEY, all);
    this.rememberedHint = this.hint;
  }

  refresh(cx) {
    const t = target();
    const key = t ? `${t.address}:${t.created}:${t.app}` : "";
    const switched = key !== this.key;
    if (switched) {
      this.stash();
      this.key = key; this.needsScroll = false; this.settling = true; this.pendingCount = -1; this.follow(); this.screen = ""; this.lastId = ""; this.screenAskedAt = 0;
      this.watchToken = (this.watchToken ?? 0) + 1; this.watchedPath = "";
      const kept = key ? this.sessions.get(key) : null;
      if (kept) Object.assign(this, kept);
      else {
        const known = t ? (shared(PATHS_KEY) ?? {})[`${t.address}:${t.created}`] : null;
        this.path = known?.path ?? ""; this.hint = known?.hint ?? "";
        this.raw = []; this.calls = new Map(); this.offset = 0; this.leaf = ""; this.messages = []; this.open = {}; this.clipped = false;
        this.note = !t ? "Select a Claude Code, Codex or Pi terminal to see it as a chat." : `Opening this ${t.label} conversation…`;
      }
      cx.notify();
    }
    if (!t) return;
    if (switched) { this.read(cx); return; }
    if (!this.path || t.remote || Date.now() - this.lastRead > 15000) this.read(cx);
    if (t.status === "blocked" && !this.readingScreen) {
      this.readingScreen = true;
      cx.spawn(async cx => {
        try {
          const screen = await hc(["read", t.address, "--lines", "26"]);
          const text = screen.code === 0 ? screen.stdout.trim().slice(-4000) : "";
          if (text !== this.screen) { this.screen = text; cx.notify(); }
        } finally { this.readingScreen = false; }
      });
    } else if (t.status !== "blocked" && this.screen) { this.screen = ""; cx.notify(); }
  }

  watch(cx, path) {
    if (!path || path === this.watchedPath) return;
    this.watchedPath = path;
    const token = this.watchToken = (this.watchToken ?? 0) + 1;
    const dir = path.replace(/[\\/][^\\/]*$/, "");
    cx.spawn(async cx => {
      while (this.watchToken === token) {
        let changed;
        try { changed = await watchFolder(dir); } catch { return; }
        if (this.watchToken !== token) return;
        if (changed.some(p => /\.jsonl$/i.test(p))) this.read(cx);
      }
    });
  }

  read(cx) {
    const t = target();
    if (!t) return;
    const key = this.key;
    if (this.reading === key) { this.dirty = true; return; }
    this.reading = key; this.dirty = false; this.lastRead = Date.now();
    cx.spawn(async cx => {
      try {
        const machineOf = a => a.address.includes("/") ? a.address.split("/")[0] : null;
        const peers = agents().filter(a => a.app === t.app && a.address !== t.address && machineOf(a) === t.machine).length;
        const at = { path: this.path, hint: this.hint, offset: this.offset, peers, leaf: this.leaf };
        let r = await runReader(t, at);
        if (this.key !== key) return;
        if (r.code === 0 && /^NEED\|screen/m.test(r.stdout) && Date.now() - (this.screenAskedAt ?? 0) > 15000) {
          this.screenAskedAt = Date.now();
          const shown = await hc(["read", t.address, "--lines", "40"]);
          if (this.key !== key) return;
          r = await runReader(t, { ...at, screen: shown.code === 0 ? shown.stdout.slice(-3000) : "" });
          if (this.key !== key) return;
        }
        if (r.code !== 0) throw new Error(r.stderr || `Reader exited ${r.code}`);
        this.merge(r.stdout);
        if (!t.remote) this.watch(cx, this.path);
      } catch (e) { this.note = String(e); }
      finally {
        if (this.reading === key) {
          this.reading = null;
          if (this.dirty) this.read(cx);
        }
        cx.notify();
      }
    });
  }

  merge(stdout) {
    const added = [];
    let path = this.path, note = "", reset = false;
    for (const line of stdout.split(/\r?\n/)) {
      const bar = line.indexOf("|"), tag = bar < 0 ? line : line.slice(0, bar), rest = line.slice(bar + 1);
      if (tag === "PATH") path = decodeURIComponent(rest);
      else if (tag === "HINT") this.hint = decodeURIComponent(rest);
      else if (tag === "NOTE") note = decodeURIComponent(rest);
      else if (tag === "OFFSET") this.offset = Number(rest) || 0;
      else if (tag === "LEAF") this.leaf = decodeURIComponent(rest);
      else if (tag === "RESET") reset = true;
      else if (tag === "R") added.push({ kind: "reasoning", text: decodeURIComponent(rest) });
      else if (tag === "C") {
        const [id, json] = rest.split("|");
        added.push({ kind: "call", id: decodeURIComponent(id), call: JSON.parse(decodeURIComponent(json)) });
      } else if (tag === "O") {
        const [id, ...text] = rest.split("|");
        added.push({ kind: "out", id: decodeURIComponent(id), text: decodeURIComponent(text.join("|")) });
      } else if (tag === "M") {
        const [role, phase, ...text] = rest.split("|");
        let body = decodeURIComponent(text.join("|"));
        if (role === "user") body = body.replace(/^\s*<hc from="[^"]*"[^>]*>([\s\S]*?)<\/hc>\s*$/, "$1");
        added.push({ kind: "message", role, phase, text: body });
      }
    }
    if (reset || path !== this.path) { this.raw = []; this.calls = new Map(); }
    if (path && (path !== this.path || this.hint !== this.rememberedHint)) this.rememberPath(path);
    this.path = path;
    for (const e of added) {
      if (e.kind === "call") { this.raw.push(e); if (e.id) this.calls.set(e.id, e.call); }
      else if (e.kind === "out") { const c = this.calls.get(e.id); if (c) c.o = e.text; }
      else this.raw.push(e);
    }
    if (this.raw.length > 600) this.raw = this.raw.slice(-500);
    const shaped = [];
    for (const e of this.raw) {
      if (e.kind !== "call") { shaped.push(e); continue; }
      const last = shaped[shaped.length - 1];
      const copy = { ...e.call };
      CALL_SOURCE.set(copy, e.call);
      if (last?.kind === "tools") last.calls.push(copy); else shaped.push({ kind: "tools", calls: [copy] });
    }
    this.messages = foldActivity(shaped);
    if (note || reset) {
      this.clipped = note.startsWith("Showing the recent part");
      this.note = this.clipped ? "" : note;
    } else if (this.note && this.messages.length) this.note = "";
    const last = this.messages[this.messages.length - 1];
    const id = last ? `${this.messages.length}:${last.kind}:${last.text ?? last.calls.length}:${last.calls?.at(-1)?.o?.length ?? 0}` : "";
    if (id !== this.lastId) { this.lastId = id; if (this.following) this.follow(); }
  }

  /** Enter (without Shift): sends, and never leaves a new line in the box. */
  enter(cx) {
    this.enterAt = Date.now();
    const v = this.input.value(), s = v.replace(/\r?\n$/, "");
    if (s !== v) this.input.set_value(s);
    this.send(cx);
  }

  send(cx) {
    const t = target(), typed = this.input.value().trim(), attached = this.attachments.slice();
    if (!t || (!typed && !attached.length) || this.sending) return;
    this.sending = true;
    // The box empties at once, as in any chat; a send that fails puts the draft back.
    this.input.set_value("");
    this.attachments = this.attachments.filter(a => !attached.includes(a));
    cx.notify();
    const restore = () => {
      if (!this.input.value().trim()) this.input.set_value(typed);
      this.attachments = [...attached.filter(a => !this.attachments.includes(a)), ...this.attachments];
    };
    cx.spawn(async cx => {
      try {
        if (t.status === "blocked" && !(await this.promptStillCurrent(t))) throw new Error("The prompt changed. Review it again before answering.");
        // The agent's own box may still hold the mirrored draft (or something typed there): the chat's
        // text is what goes, so the box is emptied first rather than sent along with it.
        if (DRAFT_MIRROR[t.app] && !onWindows() && t.status !== "blocked") {
          await this.mirrorChain;
          if (this.mirror?.session === `${t.address}:${t.created}` && this.mirror.foreign)
            throw new Error(`${t.label}'s input box has an image pasted in the terminal. Send that draft from the terminal, or clear it there, first.`);
          const c = await exec("python3", ["-I", modFile("input-box.py"), "set", t.address, t.app, "[]"]).catch(() => null);
          if (c?.code === 0) this.mirror = null;
        }
        const placed = await this.placeImages(t, attached);
        if (attachStyle(t.app) === "paste") {
          for (const path of placed) {
            const p = await exec("python3", ["-I", modFile("input-box.py"), "paste", t.address, path]).catch(e => ({ code: 1, stderr: String(e) }));
            if (p.code !== 0) throw new Error(`Couldn't paste the image into ${t.label}: ${(p.stderr || p.stdout || "paste failed").trim()}`);
          }
          if (!typed) {
            const k = await hc(["keys", t.address, "enter"]);
            if (k.code !== 0) throw new Error(k.stderr || "Send failed");
            this.forget(attached.map(a => a.file));
            this.follow();
            return;
          }
        }
        const message = withImages(t.app, placed, typed);
        const force = t.status === "blocked" ? ["--force"] : [];
        const r = t.remote
          ? await exec("sh", ["-c", 'h=$(command -v hc || echo "$HOME/.local/bin/hc"); exec env -u HC_TERMINAL_ID -u HC_SCOPE "$h" send "$@"',
              "hc-send", ...force, t.address.slice(t.address.indexOf("/") + 1), message], { on: t.machine })
          : onWindows()
          ? await exec("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
              `${appHome()}\\mods\\herdr-chat\\send.ps1`, "-Address", t.address, "-Text64", base64Utf8(message),
              ...(force.length ? ["-Force"] : [])])
          : await exec("env", ["-u", "HC_TERMINAL_ID", "-u", "HC_SCOPE", "hc", "send", ...force, t.address, message]);
        if (r.code !== 0) throw new Error(r.stderr || "Send failed");
        this.mirror = { session: `${t.address}:${t.created}`, sig: "\u0000", images: [], paths: [], pasted: "", textBox: "", box: "", foreign: false };
        this.forget(attached.map(a => a.file));
        this.follow();
      } catch (e) { this.note = String(e); restore(); }
      finally { this.sending = false; cx.notify(); }
    });
  }

  /** `hc put` each image beside the agent's terminal (this computer or another) and return where they landed. */
  async placeImages(t, attached) {
    const placed = [];
    const where = `${t.address}:${t.created}`;
    for (const a of attached) {
      if (a.placed?.[where]) { placed.push(a.placed[where]); continue; }
      const r = await hc(["put", "--json", t.address, a.file]);
      let path = null;
      try { path = r.code === 0 ? JSON.parse(r.stdout).path : null; } catch {}
      if (!path) throw new Error(`Couldn't send ${a.name}${t.machine ? ` to ${t.machine}` : ""}: ${(r.stderr || r.stdout || "hc put failed").trim()}`);
      (a.placed ??= {})[where] = path;
      placed.push(path);
    }
    return placed;
  }

  /** Runs a prepare script; resolves with the preview copy's path, or null with the reason in the note. */
  async prepare(args, label) {
    const r = onWindows()
      ? await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", modFile("prepare-image.ps1"), ...args.windows]).catch(e => ({ code: 1, stderr: String(e) }))
      : await exec("sh", args.unix).catch(e => ({ code: 1, stderr: String(e) }));
    const file = (r.stdout ?? "").trim().split(/\r?\n/).pop();
    if ((r.code === 0 || r.code === 5) && file) {
      if (r.code === 5) this.note = `${label} is over 256 KB and nothing here can shrink it (install ImageMagick), so Claude Code may not attach it.`;
      return file;
    }
    if (r.code === 3) return null; // no image on the clipboard
    this.note = r.code === 4
      ? "Pasting images needs wl-paste (Wayland), xclip (X11) or pngpaste (macOS). Drop the file instead."
      : `Couldn't attach ${label}: ${(r.stderr || "it couldn't be read").trim()}`;
    return null;
  }

  attach(file, name, cx) {
    this.attachments.push({ name, file, rel: `${ATTACH_DIR}/${file.split(/[\\/]/).pop()}` });
    cx.notify();
  }

  /** Deletes preview copies: after a send, or when one is removed from the box. */
  forget(files) {
    if (!files.length) return;
    (onWindows()
      ? exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath ${files.map(psQuote).join(", ")}`])
      : exec("rm", ["-f", "--", ...files])).catch(() => null);
  }

  /** Preview copies left by a copy that closed before sending them: anything older than a day. */
  pruneCache() {
    (onWindows()
      ? exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
          `Get-ChildItem -LiteralPath ${psQuote(attachDir())} -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } | Remove-Item -Force`])
      : exec("sh", ["-c", '[ -d "$1" ] && find "$1" -type f -mmin +1440 -delete; exit 0', "sh", attachDir()])).catch(() => null);
  }

  /** Dropped files: images get a preview copy (shrunk when big) and are attached; anything else is ignored. */
  dropFiles(paths, cx) {
    const images = paths.filter(p => IMAGE_FILE.test(p));
    if (!images.length) { this.note = "Only images can be attached (png, jpg, gif, webp)."; cx.notify(); return; }
    cx.spawn(async cx => {
      for (const source of images) {
        const label = source.split(/[\\/]/).pop(), name = attachName(source);
        const file = await this.prepare({
          unix: [modFile("prepare-image.sh"), source, attachDir(), name],
          windows: ["-Source", source, "-Folder", attachDir(), "-Name", name],
        }, label);
        if (file) this.attach(file, label, cx);
        else cx.notify();
      }
    });
  }

  /** Ctrl+V with an image (and no text) on the clipboard: attached like a dropped file. */
  pasteImage(cx) {
    cx.spawn(async cx => {
      const name = attachName("pasted");
      const file = await this.prepare({
        unix: ["-c",
          'dir=$1 name=$2 raw="$1/$2-clipboard.png"; mkdir -p "$dir" || exit 1; ' +
          'if command -v wl-paste >/dev/null 2>&1 && [ -n "$WAYLAND_DISPLAY" ]; then ' +
          '  wl-paste --list-types 2>/dev/null | grep -qx image/png || exit 3; wl-paste --type image/png > "$raw"; ' +
          'elif command -v xclip >/dev/null 2>&1; then ' +
          '  xclip -selection clipboard -t TARGETS -o 2>/dev/null | grep -qx image/png || exit 3; xclip -selection clipboard -t image/png -o > "$raw"; ' +
          'elif command -v pngpaste >/dev/null 2>&1; then pngpaste "$raw" || exit 3; ' +
          'else exit 4; fi; [ -s "$raw" ] || { rm -f "$raw"; exit 3; }; ' +
          'sh "$3" "$raw" "$dir" "$name"; code=$?; rm -f "$raw"; exit $code',
          "sh", attachDir(), name, modFile("prepare-image.sh")],
        windows: ["-Clipboard", "-Folder", attachDir(), "-Name", name],
      }, "the pasted image");
      if (file) this.attach(file, "Pasted image", cx);
      else cx.notify();
    });
  }

  attachmentStrip(t) {
    return h_flex().w_full().flex_wrap().gap(8).pt(2).pb(4)
      .children(this.attachments.map((a, i) => div().id(`attachment-${i}`).relative().size(64).flex_none().rounded(10).overflow_hidden()
        .border_1().border_color(t.border).bg(t.raised)
        .tooltip(a.name)
        .child(image(a.rel).size_full())
        .child(div().id(`attachment-remove-${i}`).absolute().top(3).right(3).size(18).flex().items_center().justify_center()
          .rounded(9).bg(t.background).border_1().border_color(t.border).text_color(t.muted).cursor_pointer()
          .hover(s => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.forget(this.attachments.splice(i, 1).map(x => x.file)); cx.notify(); })
          .child(icon("close", 10, t.muted)))));
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

  header(t, active) {
    const program = active?.program;
    const glyph = program?.icon
      ? (program.tint ? svg(program.icon).size(15).flex_none().text_color(t.muted) : image(program.icon).size(15).flex_none())
      : null;
    const segment = (id, label, selected, action) => div().id(id).px(10).h(24).flex().items_center().rounded(6)
      .text_size(12.5).text_color(selected ? t.foreground : t.muted).when(selected, el => el.bg(t.selected))
      .when(!selected, el => el.cursor_pointer().hover(s => s.text_color(t.foreground)).on_click(action))
      .child(label);
    const pane = active?.pane, zoomed = Boolean(pane && panes().find(p => p.pane === pane)?.zoomed);
    const paneButton = (id, glyph, command, args) => div().id(id).p(3).rounded(4).flex_none().cursor_pointer()
      .text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); run(command, args); })
      .child(svg(`${ICONS}/${glyph}.svg`).size(14));
    return h_flex().id("chat-header").h(42).px(14).gap(9).items_center().flex_none()
      .on_hover((hovered, cx) => { if (this.headerHovered !== hovered) { this.headerHovered = hovered; cx.notify(); } })
      .when(Boolean(glyph), el => el.child(glyph))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.muted).child(active?.title || active?.label || ""))
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
        .child(segment("view-terminal", "Terminal", false, () => switchTo("terminal", active ? `${active.address}:${active.created}` : ""))));
  }

  status(t, active) {
    if (active?.status === "blocked") {
      const key = (id, label, k) => div().id(id).h(30).px(12).flex().items_center().rounded(8).cursor_pointer()
        .border_1().border_color(t.border).bg(t.background).text_size(12.5).text_color(t.foreground)
        .hover(s => s.bg(t.hover)).on_click((_e, cx) => k === "terminal" ? switchTo("terminal", active ? `${active.address}:${active.created}` : "") : this.press(k, cx)).child(label);
      return v_flex().w_full().max_w(COLUMN).p(14).gap(10).rounded(14).border_1().border_color(t.blocked).bg(t.surface)
        .child(h_flex().gap(8).items_center()
          .child(div().size(8).rounded(4).bg(t.blocked))
          .child(div().text_size(13.5).font_semibold().text_color(t.foreground).child(`${active.label} needs your input`)))
        .child(div().max_h(220).overflow_y_scrollbar().px(10).py(8).rounded(8).bg(t.background)
          .font_family(mono()).text_size(12).text_color(t.muted)
          .child(this.screen ? this.screen.split("\n").filter(l => l.trim()).slice(-12).join("\n") : "Open the terminal to review the request."))
        .child(h_flex().gap(6).flex_wrap()
          .child(key("k-up", "↑", "up")).child(key("k-down", "↓", "down"))
          .child(key("k-enter", "Enter", "enter")).child(key("k-esc", "Esc", "esc"))
          .child(div().flex_1())
          .child(key("k-term", "Open terminal", "terminal")));
    }
    if (active?.status === "working") return h_flex().w_full().max_w(COLUMN).h(26).gap(8).items_center()
      .child(div().w(14).text_size(15).text_color(t.accent).frames(SPARK, 120).child(SPARK[0]))
      .child(div().flex_1().min_w(0).truncate().text_size(13.5).text_color(t.muted)
        .loop("opacity", { from: 0.55, to: 1, period: 1600 }).child(active.activity ? `${active.activity}…`.replace(/……$/, "…") : "Working…"));
    return null;
  }

  composer(t, active) {
    const ready = (Boolean(this.input.value().trim()) || this.attachments.length > 0) && !this.sending && Boolean(active);
    return v_flex().w_full().max_w(COLUMN).gap(6)
      .child(h_flex().id("composer-box").w_full().pl(16).pr(8).py(8).gap(8).items_end().rounded(18).border_1().border_color(t.input).bg(t.surface)
        .child(v_flex().flex_1().min_w(0)
          .when(this.attachments.length > 0, el => el.child(this.attachmentStrip(t)))
          .child(div().id("composer-input").w_full().min_w(0).py(4)
          .on_key_down((e, cx) => {
            const paste = e.key === "v" && (e.modifiers.control || e.modifiers.platform) && !e.modifiers.alt;
            if (paste && cx.read_from_clipboard() === undefined) { cx.stop_propagation(); this.imagePasteAt = Date.now(); this.pasteImage(cx); return; }
            if (e.key !== "enter" || e.modifiers.shift || e.modifiers.alt) return;
            cx.stop_propagation();
            this.enter(cx);
          })
          .child(Textarea.new(this.input).w_full().text_size(15).text_color(t.foreground))))
        .child(div().id("send").size(32).flex_none().flex().items_center().justify_center().rounded(16)
          .bg(ready ? t.accent : t.raised).text_color(ready ? t.accent_foreground : t.dim)
          .when(ready, el => el.cursor_pointer().hover(s => s.opacity(0.88)).on_click((_e, cx) => this.send(cx)))
          .child(svg(`${ICONS}/arrow-up.svg`).size(16))))
      .child(div().w_full().text_center().text_size(11.5).text_color(t.dim)
        .child(active ? `Sends to the live ${active.label} terminal · drop or paste an image to attach it` : ""));
  }

  render(cx) {
    if (this.initError) return div().p(20).text_color(theme().blocked).child(`herdr-chat init error: ${this.initError}`);
    try { return this.renderInner(cx); }
    catch (e) { return div().p(20).text_color(theme().blocked).child(`herdr-chat render error: ${e?.stack ?? e}`); }
  }

  renderInner() {
    if (this.asHeader) return terminalHeader(this);
    const t = theme();
    const active = target();
    const rows = this.messages.slice();
    if (this.note) rows.push({ kind: "note", text: this.note });
    const empty = rows.length === 0 || (rows.length === 1 && rows[0].kind === "note" && !this.messages.length);
    this.isEmpty = empty;
    keyRows(rows);
    const inner = Math.min(COLUMN, Math.max(280, Math.floor(this.width) - 50));
    if (inner !== this.measuredAt) { this.heights = {}; this.changedAt = {}; this.measuredAt = inner; }
    const hkey = m => `${m.key}${this.open[m.key] ? ":open" : ""}`;
    const unmeasured = rows.filter(m => !(hkey(m) in this.heights)).slice(-40);
    this.pendingCount = unmeasured.length;
    // A row stays in the measure until its height has held for a while: a long reply's
    // markdown can finish wrapping after its first size is reported, and a row kept at
    // that first, shorter height draws over the rows below it.
    const now = Date.now();
    const settling = rows.filter(m => { const k = hkey(m); return k in this.heights && now - (this.changedAt[k] ?? 0) < 2000; });
    const pending = [...settling, ...unmeasured];
    const sizes = rows.map((m, i) => (this.heights[hkey(m)] ?? 40) + 16 + (i === rows.length - 1 ? TAIL : 0));
    this.sig = `${rows.length}:${sizes.reduce((a, b) => a + b, 0)}`;
    this.noticeVisit();
    const status = this.status(t, active);
    this.rowCount = rows.length;
    return v_flex().id("herdr-chat-root").relative().size_full().min_h(0).rounded(10).border_1().border_color(t.border)
      .bg(t.background).text_color(t.foreground)
      .on_size_change((size, cx) => { if (size.width >= 200 && Math.abs(size.width - this.width) > 8) { this.width = size.width; cx.notify(); } })
      .on_drop((e, cx) => this.dropFiles(e.paths ?? [], cx))
      .child(this.header(t, active))
      .when(empty, el => el.child(v_flex().flex_1().min_h(0).items_center().justify_center().gap(14).px(24)
        .child(image("frame/welcome/herdr.png").size(64).rounded(14).flex_none()
          .when(/^(Opening|Finding)/.test(this.note || ""), el => el.loop("opacity", { from: 0.4, to: 1, period: 1600 })))
        .child(div().max_w(420).text_center().text_size(14).text_color(t.muted).child(this.note))))
      .when(!empty, el => el.child(v_flex().relative().flex_1().min_h(0).when(this.settling, el => el.opacity(0))
        .child(v_virtual_list("herdr-chat-messages", rows.length, sizes, i => rows[i].key, range => {
        this.visibleEnd = range.end;
        this.laidOut = Date.now();
        const out = [];
        for (let i = range.start; i < range.end; i++)
          out.push(h_flex().w_full().justify_center().px(24).pt(8).pb(i === rows.length - 1 ? 8 + TAIL : 8).child(div().w_full().max_w(COLUMN).child(this.row(rows[i], rows[i].key, t))));
        return out;
      }).track_scroll(this.scroll).on_item_click((key, cx) => {
        const kind = rows.find(r => r.key === key)?.kind;
        if (kind === "tools" || kind === "reasoning") { this.open[key] = !this.open[key]; cx.notify(); }
      }).size_full())
        // Strips of the background, each more opaque than the one above (a gradient, from
        // parts that draw everywhere; Background.linear_gradient threw while rendering).
        .child(v_flex().absolute().bottom(0).left(0).right(0).h(FADE)
          .children(Array.from({ length: 8 }, (_, i) => div().w_full().flex_1().bg(t.background).opacity((i + 1) / 8))))
        .when(!this.following && !this.needsScroll, el => el.child(h_flex().absolute().bottom(12).left(0).right(0).justify_center()
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
              if (this.heights[k] !== size.height) {
                this.heights[k] = size.height; this.changedAt[k] = Date.now();
                if (this.following) this.follow();
                cx.notify();
                cx.timer.after?.(2100, cx => cx.notify());
              }
            })
            .child(this.row(m, m.key, t));
        }))))
      .child(v_flex().w_full().flex_none().items_center().px(24).pt(12).pb(14).gap(12)
        .when(Boolean(status), el => el.child(status))
        .child(this.composer(t, active)));
  }
}
