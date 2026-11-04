// Reading agents' conversations from their logs (read_session.py, run on the agent's machine): the
// one on screen, from where it last stopped, and in the background every other listed agent's, so a
// switch shows one at once. Mixed into the chat's View (main.js), so `this` is the view; the state of
// a session and what the reader says about it are in session.js.
import { exec, appHome, shared, setShared, watchFolder } from "herdr";
import { readFile } from "fs/promises";
import { sessionOf, chatKey } from "./common.js";
import { onWindows, base64Utf8 } from "./platform.js";
import { target, agentTargets, readScreen, readPrompt } from "./terminal.js";
import { parseChoices } from "./prompts.js";
import { blankSession, parseReader, applyRead, readerArgs, batchProgram, splitBatch } from "./session.js";

/** Sessions kept in memory: every listed agent's, kept read in the background, so a switch shows one at once. */
const SESSIONS_KEPT = 32;
/** How often the background reads every other agent's log (from where it last stopped). */
const WARM_EVERY = 4000;
/**
 * A cached conversation read longer ago than STALE_AFTER may have news: a read of it that takes over
 * CHECK_AFTER shows "Checking for new messages…", and one that takes over SILENT_AFTER says the
 * machine isn't answering.
 */
const STALE_AFTER = 3000, CHECK_AFTER = 300, SILENT_AFTER = 5000;
/** Which log each session reads, kept across restarts. */
const PATHS_KEY = "herdr-chat.paths";

let readerBase64 = null;
async function readerSource() {
  if (!readerBase64) readerBase64 = base64Utf8(await readFile(`${appHome()}/mods/herdr-chat/read_session.py`, "utf8"));
  return readerBase64;
}

async function runReader(t, at) {
  const { path, hint, offset, leaf } = at;
  if (!t.remote && onWindows()) {
    return exec("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      `${appHome()}\\mods\\herdr-chat\\read-session.ps1`,
      "-App", t.app, "-TermPid", String(t.pid), "-CreatedMs", String(t.created), "-Cwd", t.cwd,
      "-KnownPath", path || "", "-Hint", hint || "", "-Offset", String(offset || 0), "-Leaf", leaf || ""]);
  }
  const boot = `import base64,sys;sys.argv[0]='read_session';exec(compile(base64.b64decode('${await readerSource()}'),'read_session.py','exec'))`;
  return exec("python3", ["-c", boot, ...readerArgs(t, at)], t.machine ? { on: t.machine } : undefined);
}

/** Reads several sessions on one machine (null: this one) in one Python run; each one's output, or null. */
async function runReaders(machine, list) {
  const program = batchProgram(await readerSource());
  const r = await exec("python3", ["-c", program, base64Utf8(JSON.stringify(list.map(([t, at]) => readerArgs(t, at))))], machine ? { on: machine } : undefined);
  return r.code === 0 ? splitBatch(r.stdout) : null;
}

/** Other agents of the same program on the same machine (the reader tells sessions apart by them). */
function peersOf(t, all = agentTargets()) {
  return all.filter(a => a.app === t.app && a.address !== t.address && a.machine === t.machine).length;
}

export const ReadingMethods = {
  /** The view's reading state before anything is read, and the background reads started. */
  initReading(cx) {
    Object.assign(this, blankSession());
    this.note = "Loading conversation…"; this.lastRead = 0; this.sessions = new Map();
    cx.timer.every(WARM_EVERY, cx => this.warm(cx));
  },

  /**
   * Shows another session: the one on screen kept, the new one restored (or started). Runs in the
   * frame that first sees the new agent, so header and conversation change together; what can't
   * run while drawing (the reply box's draft, the read) waits for refresh() on the next tick.
   */
  switchSession(t, key) {
    this.stash();
    if (!this.pendingDraft) this.pendingDraft = { from: this.key };
    this.key = key; this.needsScroll = false; this.settling = true; this.pendingCount = -1; this.follow(); this.screen = ""; this.choices = null; this.lastId = ""; this.screenAskedAt = 0;
    this.watchToken = (this.watchToken ?? 0) + 1; this.watchedPath = ""; this.readError = ""; this.readStartedAt = 0;
    const kept = key ? this.sessions.get(key) : null;
    if (kept) Object.assign(this, kept);
    else {
      const known = t ? (shared(PATHS_KEY) ?? {})[sessionOf(t)] : null;
      Object.assign(this, blankSession(known?.path ?? "", known?.hint ?? ""));
      this.note = !t ? "Select a Claude Code, Codex or Pi terminal to see it as a chat." : `Opening this ${t.label} conversation…`;
    }
    this.needsFirstRead = Boolean(t);
  },

  /** The session on screen kept in memory, to show at once when it is selected again. */
  stash() {
    if (!this.key || !this.path) return;
    const kept = {};
    for (const k of Object.keys(blankSession())) kept[k] = this[k];
    this.sessions.delete(this.key);
    this.sessions.set(this.key, kept);
    this.trimSessions();
  },

  /** Down to SESSIONS_KEPT: sessions whose agent is gone go first, then the least recently shown. */
  trimSessions(live) {
    if (this.sessions.size <= SESSIONS_KEPT) return;
    if (live) for (const k of [...this.sessions.keys()]) if (this.sessions.size > SESSIONS_KEPT && !live.has(k) && k !== this.key) this.sessions.delete(k);
    while (this.sessions.size > SESSIONS_KEPT) this.sessions.delete(this.sessions.keys().next().value);
  },

  /**
   * Every tick: switches when the selected agent changed, swaps the reply box's draft after a switch,
   * reads the session on screen (at once after a switch; every tick for an agent on another machine,
   * which has no file watch), and reads the screen for a choice prompt while the agent works.
   */
  refresh(cx) {
    const t = target();
    const key = chatKey(t);
    if (key !== this.key) { this.switchSession(t, key); cx.notify(); }
    if (this.pendingDraft) { this.swapDraft(this.key, this.pendingDraft.from); this.pendingDraft = null; cx.notify(); }
    const switched = this.needsFirstRead;
    this.needsFirstRead = false;
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
  },

  /**
   * Reads the session on screen from where it last stopped. A read already running for it marks it
   * dirty to read again after; a slow or failed one keeps what's shown and says so (readCue).
   */
  read(cx) {
    const t = target();
    if (!t) return;
    const key = this.key;
    if (this.reading === key) { this.dirty = true; return; }
    const token = this.readSeq = (this.readSeq ?? 0) + 1;
    this.reading = key; this.dirty = false; this.lastRead = Date.now();
    this.readStartedAt = Date.now(); this.readStaleFor = Date.now() - (this.readAt || 0);
    const mine = () => this.key === key && this.readSeq === token;
    cx.spawn(async cx => {
      try {
        const at = { path: this.path, hint: this.hint, offset: this.offset, peers: peersOf(t), leaf: this.leaf };
        let r = await runReader(t, at);
        if (!mine()) return;
        if (r.code === 0 && /^NEED\|screen/m.test(r.stdout) && Date.now() - (this.screenAskedAt ?? 0) > 15000) {
          this.screenAskedAt = Date.now();
          const shown = await readScreen(t, 40);
          if (!mine()) return;
          r = await runReader(t, { ...at, screen: shown != null ? shown.slice(-3000) : "" });
          if (!mine()) return;
        }
        if (r.code !== 0) throw new Error(r.stderr || `Reader exited ${r.code}`);
        this.merge(r.stdout);
        this.readError = "";
        if (!t.remote) this.watch(cx, this.path);
      } catch (e) {
        if (!mine()) return;
        if (this.messages.length) this.readError = String(e?.message ?? e).split("\n")[0] || "no answer";
        else this.note = String(e);
      }
      finally {
        if (this.readSeq === token) {
          this.readStartedAt = 0;
          if (this.reading === key) {
            this.reading = null;
            if (this.dirty) this.read(cx);
          }
        }
        cx.notify();
      }
    });
  },

  /** The reader's output applied to the session on screen, its log remembered, and the view following it. */
  merge(stdout) {
    applyRead(this, parseReader(stdout));
    this.readAt = Date.now();
    const t = target();
    if (t) this.rememberPath(sessionOf(t), this.path, this.hint);
    const last = this.messages[this.messages.length - 1];
    const id = last ? `${this.messages.length}:${last.kind}:${last.text ?? last.calls.length}:${last.calls?.at(-1)?.o?.length ?? 0}` : "";
    if (id !== this.lastId) { this.lastId = id; if (this.following) this.follow(); }
  },

  /** Reads again whenever the log's folder changes (agents on this computer). */
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
  },

  /** Which log a session reads, kept across restarts (herdr's shared state), so it isn't searched for again. */
  rememberPath(id, path, hint) {
    if (!id || !path) return;
    const all = { ...(shared(PATHS_KEY) ?? {}) };
    if (all[id]?.path === path && all[id]?.hint === (hint || "")) return;
    delete all[id];
    all[id] = { path, hint: hint || "" };
    const ids = Object.keys(all);
    for (const old of ids.slice(0, Math.max(0, ids.length - 200))) delete all[old];
    setShared(PATHS_KEY, all);
  },

  /**
   * Reads every other agent's session from where it last stopped (one Python run per machine), so a
   * switch to any of them shows it at once, up to date. The one on screen is read by read().
   */
  warm(cx) {
    if (this.warming) return;
    this.warming = true;
    cx.spawn(async cx => {
      try {
        const all = agentTargets(), live = new Set(), groups = new Map();
        for (const t of all) {
          const key = chatKey(t);
          live.add(key);
          if (key === this.key || !t.pid || (!t.remote && onWindows())) continue;
          const s = this.sessions.get(key);
          const known = s ? null : (shared(PATHS_KEY) ?? {})[sessionOf(t)];
          const at = s ? { path: s.path, hint: s.hint, offset: s.offset, leaf: s.leaf } : { path: known?.path ?? "", hint: known?.hint ?? "", offset: 0, leaf: "" };
          at.peers = peersOf(t, all);
          const group = groups.get(t.machine) ?? [];
          group.push({ key, t, at, s });
          groups.set(t.machine, group);
        }
        await Promise.all([...groups].map(async ([machine, list]) => {
          let outs;
          try { outs = await runReaders(machine, list.map(x => [x.t, x.at])); } catch { return; }
          if (!outs) return;
          list.forEach((x, i) => {
            if (outs[i] == null || x.key === this.key || this.sessions.get(x.key) !== x.s) return;
            const r = parseReader(outs[i]);
            if (!r.path) return;
            const s = x.s ?? blankSession(x.at.path, x.at.hint);
            applyRead(s, r);
            s.readAt = Date.now();
            if (!x.s) this.sessions.set(x.key, s);
            this.rememberPath(sessionOf(x.t), s.path, s.hint);
          });
        }));
        this.trimSessions(live);
      } finally { this.warming = false; }
    });
  },

  /** The row under the conversation while a read is slow: "checking", "silent" (no answer), or "". */
  readCue() {
    if (!this.messages.length) return "";
    const since = this.readStartedAt ? Date.now() - this.readStartedAt : 0;
    if (this.readError || since > SILENT_AFTER) return "silent";
    return since > CHECK_AFTER && this.readStaleFor > STALE_AFTER ? "checking" : "";
  },

  /** Retry on the "isn't answering" row: a new read, taking over from one that hangs. */
  retry(cx) {
    this.readError = ""; this.reading = null;
    this.read(cx);
    cx.notify();
  },
};
