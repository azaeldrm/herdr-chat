import { exec, appHome, shared, setShared, watchFolder } from "herdr";
import { readFile } from "fs/promises";
import { sessionOf, chatKey } from "./common.js";
import { onWindows, base64Utf8 } from "./platform.js";
import { target, agentTargets, readScreen, readPrompt } from "./terminal.js";
import { parseChoices } from "./prompts.js";
import { blankSession, parseReaderInSlices, applyRead, readerArgs, batchProgram, splitBatch } from "./session.js";

const SESSIONS_KEPT = 32;
const READ_AFTER = [1000, 4000];
const QUIET_EVERY = 1500;
const STALE_AFTER = 3000, CHECK_AFTER = 300, SILENT_AFTER = 5000;
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

async function runReaders(machine, list) {
  // Reads several sessions on one machine (null: this one) in one Python run; each one's output, or null.
  const program = batchProgram(await readerSource());
  const r = await exec("python3", ["-c", program, base64Utf8(JSON.stringify(list.map(([t, at]) => readerArgs(t, at))))], machine ? { on: machine } : undefined);
  return r.code === 0 ? splitBatch(r.stdout) : null;
}

function peersOf(t, all = agentTargets()) {
  // Other agents of the same program on the same machine (the reader tells sessions apart by them).
  return all.filter(a => a.app === t.app && a.address !== t.address && a.machine === t.machine).length;
}

export const ReadingMethods = {
  initReading() {
    // The view's reading state before anything is read.
    Object.assign(this, blankSession());
    this.note = "Loading conversation…"; this.lastRead = 0; this.sessions = new Map();
    this.facts = null; this.dueReads = [];
  },

  noticeAgents(cx) {
    // Reads what changed in herdr's agent list since the last look: the session on screen, others in the background.
    const all = agentTargets();
    const now = new Map(all.map(t => [chatKey(t), `${t.status}|${t.activity}|${t.turn}|${t.statusMs}`]));
    const first = !this.facts;
    const at = Date.now();
    for (const t of all) {
      const key = chatKey(t);
      if (!first && this.facts.get(key) === now.get(key)) continue;
      if (key === this.key) {
        this.shownChangedAt = at;
        if (!first) { this.read(cx); this.readQuestion(cx, t); }
        for (const ms of READ_AFTER) this.dueReads.push({ key, at: at + ms });
      } else if (!first) {
        for (const ms of READ_AFTER) this.dueReads.push({ machine: t.machine, at: at + ms });
      }
    }
    this.facts = now;
    if (first) { this.warm(cx); return; }
    const shown = all.find(t => chatKey(t) === this.key);
    if (shown?.status === "working" && at - Math.max(this.shownChangedAt ?? 0, this.quietReadAt ?? 0) >= QUIET_EVERY) {
      this.quietReadAt = at;
      if (shown.remote) this.read(cx);
      this.readQuestion(cx, shown);
    }
    const ready = this.dueReads.filter(d => d.at <= at);
    if (!ready.length) return;
    this.dueReads = this.dueReads.filter(d => d.at > at);
    if (ready.some(d => d.key !== undefined && d.key === this.key)) this.read(cx);
    const machines = new Set(ready.filter(d => d.key === undefined).map(d => d.machine));
    if (machines.size) this.warm(cx, machines);
  },

  readQuestion(cx, t) {
    // Reads the agent's screen for a question while it works or is blocked (Pi asks while working).
    if (t.status !== "blocked" && t.status !== "working") {
      if (this.screen) { this.screen = ""; this.choices = null; cx.notify(); }
      return;
    }
    if (this.readingScreen) { this.screenAgain = true; return; }
    this.readingScreen = true;
    cx.spawn(async cx => {
      try {
        const text = (await readPrompt(t)) ?? "";
        if (text !== this.screen) { this.screen = text; this.choices = parseChoices(text); cx.notify(); }
      } finally {
        this.readingScreen = false;
        if (this.screenAgain) { this.screenAgain = false; const now = target(); if (now && chatKey(now) === this.key) this.readQuestion(cx, now); }
      }
    });
  },

  switchSession(t, key) {
    // Shows another session: the one on screen kept, the new one restored (or started).
    this.shownChangedAt = Date.now();
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

  stash() {
    // The session on screen kept in memory, to show at once when it is selected again.
    if (!this.key || !this.path) return;
    const kept = {};
    for (const k of Object.keys(blankSession())) kept[k] = this[k];
    this.sessions.delete(this.key);
    this.sessions.set(this.key, kept);
    this.trimSessions();
  },

  trimSessions(live) {
    // Down to SESSIONS_KEPT: sessions whose agent is gone go first, then the least recently shown.
    if (this.sessions.size <= SESSIONS_KEPT) return;
    if (live) for (const k of [...this.sessions.keys()]) if (this.sessions.size > SESSIONS_KEPT && !live.has(k) && k !== this.key) this.sessions.delete(k);
    while (this.sessions.size > SESSIONS_KEPT) this.sessions.delete(this.sessions.keys().next().value);
  },

  refresh(cx) {
    // Switches to the selected agent's session and reads it, and its screen for a question.
    const t = target();
    const key = chatKey(t);
    if (key !== this.key) { this.switchSession(t, key); cx.notify(); }
    if (this.pendingDraft) { this.swapDraft(this.key, this.pendingDraft.from); this.pendingDraft = null; cx.notify(); }
    const switched = this.needsFirstRead;
    this.needsFirstRead = false;
    if (!t) return;
    if (switched) { this.read(cx); this.readQuestion(cx, t); }
  },

  read(cx) {
    // Reads the session on screen from where it last stopped.
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
        const update = await parseReaderInSlices(r.stdout, () => cx.sleep(0));
        if (!mine()) return;
        this.merge(update);
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

  merge(update) {
    // Applies the reader's update to the session on screen and remembers its log.
    applyRead(this, update);
    this.readAt = Date.now();
    const t = target();
    if (t) this.rememberPath(sessionOf(t), this.path, this.hint);
    const last = this.messages[this.messages.length - 1];
    const id = last ? `${this.messages.length}:${last.kind}:${last.text ?? last.calls.length}:${last.calls?.at(-1)?.o?.length ?? 0}` : "";
    if (id !== this.lastId) { this.lastId = id; if (this.following) this.follow(); }
  },

  watch(cx, path) {
    // Reads again whenever the log's folder changes (agents on this computer).
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

  rememberPath(id, path, hint) {
    // Which log a session reads, kept across restarts (herdr's shared state), so it isn't searched for again.
    if (!id || !path) return;
    const all = { ...(shared(PATHS_KEY) ?? {}) };
    if (all[id]?.path === path && all[id]?.hint === (hint || "")) return;
    delete all[id];
    all[id] = { path, hint: hint || "" };
    const ids = Object.keys(all);
    for (const old of ids.slice(0, Math.max(0, ids.length - 200))) delete all[old];
    setShared(PATHS_KEY, all);
  },

  warm(cx, machines) {
    // Reads every other agent's session in the background (those on `machines`, or all), so switching to one shows it at once.
    if (this.warming) {
      this.warmNext = machines && this.warmNext !== 'all' ? new Set([...(this.warmNext ?? []), ...machines]) : 'all';
      return;
    }
    this.warming = true;
    cx.spawn(async cx => {
      try {
        const all = agentTargets(), live = new Set(), groups = new Map();
        for (const t of all) {
          const key = chatKey(t);
          live.add(key);
          if (key === this.key || !t.pid || (!t.remote && onWindows()) || (machines && !machines.has(t.machine))) continue;
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
          for (const [i, x] of list.entries()) {
            if (outs[i] == null || x.key === this.key || this.sessions.get(x.key) !== x.s) continue;
            const r = await parseReaderInSlices(outs[i], () => cx.sleep(0));
            if (!r.path || x.key === this.key || this.sessions.get(x.key) !== x.s) continue;
            const s = x.s ?? blankSession(x.at.path, x.at.hint);
            applyRead(s, r);
            s.readAt = Date.now();
            if (!x.s) this.sessions.set(x.key, s);
            this.rememberPath(sessionOf(x.t), s.path, s.hint);
          }
        }));
        this.trimSessions(live);
      } finally {
        this.warming = false;
        const next = this.warmNext;
        this.warmNext = null;
        if (next) this.warm(cx, next === 'all' ? undefined : next);
      }
    });
  },

  readCue() {
    // The row under the conversation while a read is slow: "checking", "silent" (no answer), or "".
    if (!this.messages.length) return "";
    const since = this.readStartedAt ? Date.now() - this.readStartedAt : 0;
    if (this.readError || since > SILENT_AFTER) return "silent";
    return since > CHECK_AFTER && this.readStaleFor > STALE_AFTER ? "checking" : "";
  },

  retry(cx) {
    // Retry on the "isn't answering" row: a new read, taking over from one that hangs.
    this.readError = ""; this.reading = null;
    this.read(cx);
    cx.notify();
  },
};
