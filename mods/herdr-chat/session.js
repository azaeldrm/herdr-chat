// A conversation as the chat keeps it, and what the reader (read_session.py) says about it. No herdr
// imports: pure enough to test alone (tests/sessions.mjs).
import { foldActivity, CALL_SOURCE } from "./transcript.js";

/** A session's state before anything is read. Every key is one the chat view also has (stash/restore). */
export function blankSession(path = "", hint = "") {
  return { raw: [], calls: new Map(), offset: 0, leaf: "", path, hint, messages: [], clipped: false, note: "", open: {}, readAt: 0 };
}

/** The reader's output as one update: its tags, and the entries it read, in order. */
export function parseReader(stdout) {
  const r = { path: null, hint: null, note: "", offset: null, leaf: null, reset: false, need: false, added: [] };
  for (const line of stdout.split(/\r?\n/)) {
    const bar = line.indexOf("|"), tag = bar < 0 ? line : line.slice(0, bar), rest = line.slice(bar + 1);
    if (tag === "PATH") r.path = decodeURIComponent(rest);
    else if (tag === "HINT") r.hint = decodeURIComponent(rest);
    else if (tag === "NOTE") r.note = decodeURIComponent(rest);
    else if (tag === "OFFSET") r.offset = Number(rest) || 0;
    else if (tag === "LEAF") r.leaf = decodeURIComponent(rest);
    else if (tag === "RESET") r.reset = true;
    else if (tag === "NEED") r.need = true;
    else if (tag === "R") r.added.push({ kind: "reasoning", text: decodeURIComponent(rest) });
    else if (tag === "C") {
      const [id, json] = rest.split("|");
      r.added.push({ kind: "call", id: decodeURIComponent(id), call: JSON.parse(decodeURIComponent(json)) });
    } else if (tag === "O") {
      const [id, ...text] = rest.split("|");
      r.added.push({ kind: "out", id: decodeURIComponent(id), text: decodeURIComponent(text.join("|")) });
    } else if (tag === "M") {
      const [role, phase, ...text] = rest.split("|");
      let body = decodeURIComponent(text.join("|"));
      if (role === "user") body = body.replace(/^\s*<hc from="[^"]*"[^>]*>([\s\S]*?)<\/hc>\s*$/, "$1");
      r.added.push({ kind: "message", role, phase, text: body });
    }
  }
  return r;
}

/**
 * An update applied to a session `s` (the chat view itself, or one kept in memory): its new entries
 * added (all of them again after a RESET or a new log), its rows rebuilt, its note set.
 */
export function applyRead(s, r) {
  if (r.hint != null) s.hint = r.hint;
  if (r.offset != null) s.offset = r.offset;
  if (r.leaf != null) s.leaf = r.leaf;
  const path = r.path ?? s.path;
  if (r.reset || path !== s.path) { s.raw = []; s.calls = new Map(); }
  s.path = path;
  for (const e of r.added) {
    if (e.kind === "call") { s.raw.push(e); if (e.id) s.calls.set(e.id, e.call); }
    else if (e.kind === "out") { const c = s.calls.get(e.id); if (c) c.o = e.text; }
    else s.raw.push(e);
  }
  if (s.raw.length > 600) s.raw = s.raw.slice(-500);
  const shaped = [];
  for (const e of s.raw) {
    if (e.kind !== "call") { shaped.push(e); continue; }
    const last = shaped[shaped.length - 1];
    const copy = { ...e.call };
    CALL_SOURCE.set(copy, e.call);
    if (last?.kind === "tools") last.calls.push(copy); else shaped.push({ kind: "tools", calls: [copy] });
  }
  s.messages = foldActivity(shaped);
  if (r.note || r.reset) {
    s.clipped = r.note.startsWith("Showing the recent part");
    s.note = s.clipped ? "" : r.note;
  } else if (s.note && s.messages.length) s.note = "";
}

/** The reader's arguments for a terminal, from where its session was last read. */
export function readerArgs(t, at) {
  const args = ["--app", t.app, "--pid", String(t.pid), "--created", String(t.created), "--offset", String(at.offset || 0)];
  if (at.screen != null) args.push("--screen", at.screen);
  if (at.peers) args.push("--peers", String(at.peers));
  if (t.cwd) args.push("--cwd", t.cwd);
  if (at.path) args.push("--known", at.path);
  if (at.hint) args.push("--hint", at.hint);
  if (at.leaf) args.push("--leaf", at.leaf);
  return args;
}

const SPLIT = "--herdr-chat-session--";

/**
 * A `python3 -c` program that runs the reader (base64 of read_session.py) once for each argument
 * list in its first argument (base64 of a JSON list), in one process: one start-up, and one call to
 * another machine, for all its agents. Each run's output follows a separator line.
 */
export function batchProgram(readerBase64) {
  return [
    "import base64,io,json,sys",
    `code=compile(base64.b64decode('${readerBase64}'),'read_session.py','exec')`,
    "for argv in json.loads(base64.b64decode(sys.argv[1]).decode('utf-8')):",
    "  buf=io.StringIO(); real=sys.stdout; sys.stdout=buf",
    "  try:",
    "    sys.argv=['read_session']+argv; exec(code,{'__name__':'read_session'})",
    "  except SystemExit: pass",
    "  except Exception as e: buf=io.StringIO(); buf.write('ERROR|'+repr(e)+'\\n')",
    "  finally: sys.stdout=real",
    `  sys.stdout.write(${JSON.stringify(SPLIT)}+'\\n'+buf.getvalue())`,
  ].join("\n");
}

/** A batch run's output, split into each session's own (in the order they were asked for). */
export function splitBatch(stdout) {
  return stdout.split(SPLIT + "\n").slice(1);
}
