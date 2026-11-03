import { View, div, svg, image } from "gpui-kit";
import { set_theme, v_flex, h_flex, TextareaState, Textarea, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { agents, panes, focused, props, hc, exec, appHome, theme, shared, setShared, watchFolder } from "herdr";
import { readFile } from "fs/promises";
import { ICONS, switchTo, showView, preferredView, sessionOf } from "./common.js";
import { onWindows, base64Utf8 } from "./platform.js";
import { target, readScreen, readPrompt, sendMessage, pressKeys, inputBox, interruptAgent } from "./terminal.js";
import { parseChoices } from "./prompts.js";
import { ChoiceMethods } from "./choices.js";
import { ImageMethods } from "./images.js";
import { DraftMethods } from "./draft.js";
import { TranscriptMethods, foldActivity, keyRows, CALL_SOURCE, withoutRetracted } from "./transcript.js";
import { COLUMN, programIcon, paneButtons, statusBadge, viewToggle } from "./ui.js";
import { diagramFor, renderQueuedDiagrams, hasQueuedDiagrams, splitDiagrams } from "./diagrams.js";
import { caretOf, lineMove } from "./caret.js";
import { imageStyle, canMirror, withImages } from "./agents.js";
import { isHeader, terminalHeader } from "./header.js";

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
    // ↑/↓ in the reply box: herdr's textarea keeps them (and can't move to the start or end), so a
    // binding scoped to this box ("HerdrChatReply > Input": the textarea's own context is "Input")
    // turns them into the chat's actions. The keymap is the app's, so bind once per engine.
    if (!globalThis.herdrChatLineKeys) {
      globalThis.herdrChatLineKeys = cx.bind_keys([
        { keystroke: "up", action: "herdr_chat::LineUp", context: "HerdrChatReply > Input" },
        { keystroke: "down", action: "herdr_chat::LineDown", context: "HerdrChatReply > Input" },
      ]);
    }
    // Esc in the reply box stops a working agent, as Esc does in its terminal (bound once per engine).
    if (!globalThis.herdrChatStopKey) {
      globalThis.herdrChatStopKey = cx.bind_keys([{ keystroke: "escape", action: "herdr_chat::Stop", context: "HerdrChatReply > Input" }]);
    }
    // A paste with no text in it (an image) that didn't come through Ctrl+V below: right-click, say.
    this.input.on("paste_other", (_e, cx) => { if (Date.now() - (this.imagePasteAt ?? 0) > 800) this.pasteImage(cx); });
    this.following = true; this.visibleEnd = 0; this.rowCount = 0;
    this.messages = []; this.open = {};
    this.width = 900; this.needsScroll = true; this.scrollAskedAt = Date.now(); this.lastAsk = Date.now(); this.laidOut = 0; this.pendingCount = -1; this.settling = true; this.isEmpty = true;
    this.heights = {}; this.changedAt = {}; this.measuredAt = 0;
    this.lastHeight = {}; // each row's latest height, whatever key it was measured under
    this.attachments = []; // { name, file (absolute preview copy), rel (for image()) }
    // The draft mirror: what the chat box and the agent's own input box last agreed on.
    this.mirror = null; // { session: "address:created", text, box (as the agent draws it) }
    this.lastMode = shared("herdr-chat.mode"); this.lastModeSession = "";
    this.mirrorChain = Promise.resolve();
    this.pruneCache();
    this.visit = shared("herdr-chat.visit");
    this.path = ""; this.hint = ""; this.note = "Loading conversation…"; this.screen = "";
    this.raw = []; this.calls = new Map(); this.offset = 0; this.leaf = ""; this.lastRead = 0; this.sessions = new Map();
    // Each session's unsent reply: its text and attached images, kept while you look at another one.
    this.drafts = new Map();
    this.refresh(cx);
    cx.timer.every(1500, cx => { inputHighlight(cx); this.refresh(cx); });
    cx.timer.every(100, cx => {
      this.applyView();
      this.mirrorOnSwitch(cx);
      const t = target();
      if ((t ? `${sessionOf(t)}:${t.app}` : "") !== this.key) this.refresh(cx);
      this.noticeVisit();
      if (shared("herdr-chat.mode") !== "chat") return;
      // Diagrams draw off the render path, a batch per tick, while the chat is showing.
      if (hasQueuedDiagrams() && !this.drawingDiagram) {
        this.drawingDiagram = true;
        cx.spawn(async cx => { try { if (await renderQueuedDiagrams()) cx.notify(); } finally { this.drawingDiagram = false; } });
      }
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

  applyView() {
    const f = focused(), t = target();
    const focus = `${f?.space ?? ""}:${f?.tab ?? ""}:${t ? sessionOf(t) : "-"}`;
    if (focus === this.viewFocus) return;
    this.viewFocus = focus;
    showView(t ? preferredView(sessionOf(t)) : "terminal");
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
    const all = { ...(shared(PATHS_KEY) ?? {}) }, id = sessionOf(t);
    delete all[id];
    all[id] = { path, hint: this.hint || "" };
    const ids = Object.keys(all);
    for (const old of ids.slice(0, Math.max(0, ids.length - 200))) delete all[old];
    setShared(PATHS_KEY, all);
    this.rememberedHint = this.hint;
  }

  refresh(cx) {
    const t = target();
    const key = t ? `${sessionOf(t)}:${t.app}` : "";
    const switched = key !== this.key;
    if (switched) {
      this.stash();
      this.swapDraft(key);
      this.key = key; this.needsScroll = false; this.settling = true; this.pendingCount = -1; this.follow(); this.screen = ""; this.choices = null; this.lastId = ""; this.screenAskedAt = 0;
      this.watchToken = (this.watchToken ?? 0) + 1; this.watchedPath = "";
      const kept = key ? this.sessions.get(key) : null;
      if (kept) Object.assign(this, kept);
      else {
        const known = t ? (shared(PATHS_KEY) ?? {})[sessionOf(t)] : null;
        this.path = known?.path ?? ""; this.hint = known?.hint ?? "";
        this.raw = []; this.calls = new Map(); this.offset = 0; this.leaf = ""; this.messages = []; this.open = {}; this.clipped = false;
        this.note = !t ? "Select a Claude Code, Codex or Pi terminal to see it as a chat." : `Opening this ${t.label} conversation…`;
      }
      cx.notify();
    }
    if (!t) return;
    if (switched) { this.read(cx); return; }
    if (!this.path || t.remote || Date.now() - this.lastRead > 15000) this.read(cx);
    // A choice prompt can be up while the agent says it's working (Pi's ask_user_question does), so
    // the screen is read then too, and a question on it shows as a card with its choices.
    if ((t.status === "blocked" || t.status === "working") && !this.readingScreen) {
      this.readingScreen = true;
      cx.spawn(async cx => {
        try {
          const text = (await readPrompt(t)) ?? "";
          if (text !== this.screen) { this.screen = text; this.choices = parseChoices(text); cx.notify(); }
        } finally { this.readingScreen = false; }
      });
    } else if (t.status !== "blocked" && t.status !== "working" && this.screen) { this.screen = ""; this.choices = null; cx.notify(); }
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
          const shown = await readScreen(t, 40);
          if (this.key !== key) return;
          r = await runReader(t, { ...at, screen: shown != null ? shown.slice(-3000) : "" });
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

  /**
   * ↑ (dir -1) or ↓ (+1) in the reply box: the line above or below at the same column, the start on
   * the first line, the end on the last. Lines are the ones between line breaks (the textarea can't
   * say where it wraps a long line). A run of ↑/↓ keeps the column it started from.
   */
  lineKey(dir) {
    const { start, end } = caretOf(this.input);
    const from = dir < 0 ? start : end;
    const goal = this.lineGoal && this.lineGoal.at === from ? this.lineGoal.column : null;
    const { at, column } = lineMove(this.input.value(), from, dir, goal);
    this.input.set_selected_range({ start: at, end: at });
    this.lineGoal = { at, column };
  }

  /**
   * Stops the working agent (its own stop key, through hc interrupt). Claude Code then puts the
   * message it was working on back in its input box; the draft mirror reads that box into the chat's,
   * so the message is back to edit and send again. Text typed in the chat meanwhile isn't replaced.
   */
  stop(cx) {
    const t = target();
    if (!t || t.status !== "working" || this.stopping) return;
    this.stopping = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const r = await interruptAgent(t);
        if (r.outcome === "failed") throw new Error(r.error || `Couldn't stop ${t.label}.`);
        await cx.sleep(600); // the agent puts the message back after it has stopped
        if (canMirror(t.app)) {
          // its box holding exactly the last message means the agent took it back (Claude Code):
          // hide it now, rather than when the next message finally branches off before it
          const box = (await inputBox("read", t, t.app)).box;
          const last = [...this.messages].reverse().find(m => m.kind === "message");
          if (box && last?.role === "user" && box.trim() === last.text.trim()) this.retracted = { key: this.key, text: last.text };
          if (!this.input.value().trim() && !this.attachments.length) this.pullDraft(t, sessionOf(t), cx);
        }
      } catch (e) { this.note = String(e?.message ?? e); }
      finally { this.stopping = false; cx.notify(); }
    });
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
    const owner = this.key;
    const restore = () => {
      // back into the session it was written for, even if another one is showing now
      if (this.key !== owner) {
        const d = this.drafts.get(owner) ?? { text: "", attachments: [] };
        this.drafts.set(owner, { text: d.text.trim() ? d.text : typed, attachments: [...attached, ...d.attachments] });
        return;
      }
      if (!this.input.value().trim()) this.input.set_value(typed);
      this.attachments = [...attached.filter(a => !this.attachments.includes(a)), ...this.attachments];
    };
    cx.spawn(async cx => {
      try {
        if (t.status === "blocked" && !(await this.promptStillCurrent(t))) throw new Error("The prompt changed. Review it again before answering.");
        // The agent's own box may still hold the mirrored draft (or something typed there): the chat's
        // text is what goes, so the box is emptied first rather than sent along with it.
        if (canMirror(t.app) && t.status !== "blocked") {
          await this.mirrorChain;
          if (this.mirror?.session === sessionOf(t) && this.mirror.foreign)
            throw new Error(`${t.label}'s input box has an image pasted in the terminal. Send that draft from the terminal, or clear it there, first.`);
          if ((await inputBox("set", t, t.app, "[]")).ok) this.mirror = null;
        }
        const placed = await this.placeImages(t, attached);
        if (imageStyle(t.app) === "paste") {
          for (const path of placed) {
            const p = await inputBox("paste", t, path);
            if (!p.ok) throw new Error(`Couldn't paste the image into ${t.label}: ${p.error}`);
          }
          if (!typed) {
            const k = await pressKeys(t, ["enter"]);
            if (k.code !== 0) throw new Error(k.stderr || "Send failed");
            this.forget(attached.map(a => a.file));
            this.follow();
            return;
          }
        }
        const r = await sendMessage(t, withImages(t.app, placed, typed), t.status === "blocked");
        if (r.code !== 0) throw new Error(r.stderr || "Send failed");
        this.mirror = { session: sessionOf(t), sig: "\u0000", images: [], paths: [], pasted: "", textBox: "", box: "", foreign: false };
        this.forget(attached.map(a => a.file));
        this.follow();
      } catch (e) { this.note = String(e); restore(); }
      finally { this.sending = false; cx.notify(); }
    });
  }

  header(t, active) {
    const glyph = programIcon(active?.program, 15, t.muted), badge = statusBadge(t, active?.status);
    const pane = active?.pane, zoomed = Boolean(pane && panes().find(p => p.pane === pane)?.zoomed);
    return h_flex().id("chat-header").h(42).px(14).gap(9).items_center().flex_none()
      .on_hover((hovered, cx) => { if (this.headerHovered !== hovered) { this.headerHovered = hovered; cx.notify(); } })
      .when(Boolean(glyph), el => el.child(glyph))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.muted).child(active?.title || active?.label || ""))
      .when(Boolean(this.headerHovered && pane), el => el.children(paneButtons(t, pane, zoomed, "chat")))
      .when(Boolean(badge), el => el.child(badge))
      .child(viewToggle(t, "chat", "view", () => {}, () => switchTo("terminal", active ? sessionOf(active) : "")));
  }

  status(t, active) {
    const card = this.promptCard(t, active);
    if (card) return card;
    if (active?.status === "working") return h_flex().w_full().max_w(COLUMN).h(26).gap(8).items_center()
      .child(div().w(14).text_size(15).text_color(t.accent).frames(SPARK, 120).child(SPARK[0]))
      .child(div().flex_1().min_w(0).truncate().text_size(13.5).text_color(t.muted)
        .loop("opacity", { from: 0.55, to: 1, period: 1600 }).child(active.activity ? `${active.activity}…`.replace(/……$/, "…") : "Working…"));
    return null;
  }

  composer(t, active) {
    const ready = (Boolean(this.input.value().trim()) || this.attachments.length > 0) && !this.sending && Boolean(active);
    // While the agent works and the box is empty, the send button stops it (typing turns it back into Send).
    const stopping = active?.status === "working" && !this.input.value().trim() && !this.attachments.length;
    return v_flex().w_full().max_w(COLUMN).gap(6)
      .child(h_flex().id("composer-box").w_full().pl(16).pr(8).py(8).gap(8).items_end().rounded(18).border_1().border_color(t.input).bg(t.surface)
        .child(v_flex().flex_1().min_w(0)
          .when(this.attachments.length > 0, el => el.child(this.attachmentStrip(t)))
          .child(div().id("composer-input").w_full().min_w(0).py(4).key_context("HerdrChatReply")
          .on_action("herdr_chat::LineUp", () => this.lineKey(-1))
          .on_action("herdr_chat::LineDown", () => this.lineKey(1))
          .on_action("herdr_chat::Stop", (_e, cx) => this.stop(cx))
          .on_key_down((e, cx) => {
            const paste = e.key === "v" && (e.modifiers.control || e.modifiers.platform) && !e.modifiers.alt;
            if (paste && cx.read_from_clipboard() === undefined) { cx.stop_propagation(); this.imagePasteAt = Date.now(); this.pasteImage(cx); return; }
            if (e.key !== "enter" || e.modifiers.shift || e.modifiers.alt) return;
            cx.stop_propagation();
            this.enter(cx);
          })
          .child(Textarea.new(this.input).w_full().text_size(15).text_color(t.foreground))))
        .child(stopping
          ? div().id("stop").size(32).flex_none().flex().items_center().justify_center().rounded(16)
            .bg(t.foreground).text_color(t.background).tooltip("Stop (Esc)")
            .when(!this.stopping, el => el.cursor_pointer().hover(s => s.opacity(0.85)).on_click((_e, cx) => this.stop(cx)))
            .child(svg(`${ICONS}/stop.svg`).size(14))
          : div().id("send").size(32).flex_none().flex().items_center().justify_center().rounded(16)
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
    // An assistant reply with ```mermaid blocks becomes its text and a row per diagram, so a
    // diagram is measured, and measured again once drawn, on its own.
    const shown = withoutRetracted(this.messages, this.retracted?.key === this.key ? this.retracted.text : null);
    if (!shown.retracted && this.retracted?.key === this.key) this.retracted = null; // the conversation moved on
    const rows = shown.rows.flatMap(m => {
      const parts = m.kind === "message" && m.role !== "user" && m.text?.includes("```mermaid") ? splitDiagrams(m.text) : null;
      return parts ? parts.map(p => p.kind === "diagram" ? { kind: "diagram", text: p.text } : { ...m, text: p.text }) : [m];
    });
    if (this.note) rows.push({ kind: "note", text: this.note });
    const empty = rows.length === 0 || (rows.length === 1 && rows[0].kind === "note" && !this.messages.length);
    this.isEmpty = empty;
    keyRows(rows);
    const inner = Math.min(COLUMN, Math.max(280, Math.floor(this.width) - 50));
    if (inner !== this.measuredAt) { this.heights = {}; this.changedAt = {}; this.lastHeight = {}; this.measuredAt = inner; }
    // a diagram row's height changes when it finishes drawing (or fails): only that row is measured
    // again, keyed by its own state, not every diagram whenever any of them finishes
    const t0 = theme();
    const hkey = m => `${m.key}${this.open[m.key] ? ":open" : ""}${m.kind === "diagram" ? `:${diagramFor(m.text, t0).state}` : ""}`;
    const unmeasured = rows.filter(m => !(hkey(m) in this.heights)).slice(-40);
    // diagrams still drawing count as unsettled too: shown before they finish, they grow above the
    // bottom and the view jumps into them before the scroll catches up
    this.pendingCount = unmeasured.length + rows.filter(m => m.kind === "diagram" && diagramFor(m.text, t0).state === "queued").length;
    // A row stays in the measure until its height has held for a while: a long reply's
    // markdown can finish wrapping after its first size is reported, and a row kept at
    // that first, shorter height draws over the rows below it.
    const now = Date.now();
    const settling = rows.filter(m => { const k = hkey(m); return k in this.heights && now - (this.changedAt[k] ?? 0) < 2000; });
    const pending = [...settling, ...unmeasured];
    // a row being measured again keeps its last height meanwhile: collapsing it to the 40 px guess
    // makes the whole list shrink and grow back, and the view jumps
    const sizes = rows.map((m, i) => (this.heights[hkey(m)] ?? this.lastHeight[m.key] ?? 40) + 16 + (i === rows.length - 1 ? TAIL : 0));
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
                this.heights[k] = size.height; this.lastHeight[m.key] = size.height; this.changedAt[k] = Date.now();
                if (this.following) this.follow();
                cx.notify();
                cx.timer.after(2100, cx => cx.notify());
              }
            })
            .child(this.row(m, m.key, t));
        }))))
      .child(v_flex().w_full().flex_none().items_center().px(24).pt(12).pb(14).gap(12)
        .when(Boolean(status), el => el.child(status))
        .child(this.composer(t, active)));
  }
}

Object.assign(HerdrChat.prototype, ChoiceMethods);
Object.assign(HerdrChat.prototype, ImageMethods);
Object.assign(HerdrChat.prototype, DraftMethods);
Object.assign(HerdrChat.prototype, TranscriptMethods);
