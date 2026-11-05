import argparse, glob, json, os, re, sys
from datetime import datetime, timezone
from urllib.parse import quote

ap = argparse.ArgumentParser()
ap.add_argument("--app", required=True)
ap.add_argument("--pid", type=int, default=0)
ap.add_argument("--created", type=int, default=0)
ap.add_argument("--cwd", default="")
ap.add_argument("--known", default="")
ap.add_argument("--hint", default="")
ap.add_argument("--offset", type=int, default=0)
ap.add_argument("--screen", default="")
ap.add_argument("--peers", type=int, default=0)
ap.add_argument("--leaf", default="")
A = ap.parse_args()

HOME = os.path.expanduser("~")
ELLIPSIS = "\u2026"
MAX_ENTRIES = 400
TAIL = 24 * 1024 * 1024
out = []
entries = []
state = {"hint": "", "clipped": False, "fresh": True, "next": 0, "waiting": "", "need": "", "chain": None}

def esc(s): return quote(str(s), safe="")
def emit(line): out.append(line)

def done(note):
    emit("PATH|"); emit("HINT|" + esc(state["hint"])); emit("NOTE|" + esc(note)); flush(); sys.exit(0)

def flush(): sys.stdout.write("\n".join(out) + "\n")

def leaf(p):
    p = str(p or "").strip().rstrip("\\/")
    return re.split(r"[\\/]", p)[-1] if p else ""

def short(s, n):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s[:n] + ELLIPSIS if len(s) > n else s

def clip(s):
    s = str(s or "").replace("\r", "").rstrip()
    return s[:12000] + "\n" + ELLIPSIS if len(s) > 12000 else s

def add_message(role, phase, text):
    text = str(text or "").strip()
    if not text: return
    if len(text) > 12000: text = text[:12000] + "\n" + ELLIPSIS
    entries.append({"kind": "message", "role": role, "phase": phase, "text": text})

def add_reasoning(text):
    text = str(text or "").strip()
    if not text: return
    if len(text) > 12000: text = text[:12000] + "\n" + ELLIPSIS
    entries.append({"kind": "reasoning", "text": text})

def add_call(call, cid): entries.append({"kind": "call", "id": cid or "", "call": call})

def set_output(cid, text):
    if cid: entries.append({"kind": "out", "id": cid, "text": clip(text)})

def content_text(content):
    if isinstance(content, str): return content
    parts = []
    for c in content or []:
        if not isinstance(c, dict): continue
        if c.get("type") in ("text", "input_text", "output_text"): parts.append(str(c.get("text", "")))
        elif c.get("type") == "image": parts.append("[Image]")
    return "\n".join(parts)

def read_tail(path):
    """The complete lines from --offset on (or, fresh, the last 24 MB)."""
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        length = f.tell()
        state["fresh"] = A.offset <= 0 or A.offset > length or path != A.known
        start = max(0, length - TAIL) if state["fresh"] else A.offset
        state["clipped"] = state["fresh"] and start > 0
        f.seek(start)
        data = f.read(length - start)
    end = data.rfind(b"\n")
    if end < 0:
        state["next"] = start
        return []
    state["next"] = start + end + 1
    lines = data[:end + 1].decode("utf-8", "replace").split("\n")
    return lines[1:] if state["clipped"] else lines

def loads(line):
    try: return json.loads(line)
    except ValueError: return None

def claude_call(name, inp):
    inp = inp if isinstance(inp, dict) else {}
    if name in ("Bash", "PowerShell"): return {"k": "shell", "d": short(inp.get("command"), 400)}
    if name == "Read":
        fp = str(inp.get("file_path", ""))
        return {"k": "image" if re.search(r"\.(png|jpe?g|gif|webp)$", fp, re.I) else "read", "d": leaf(fp)}
    if name in ("Edit", "MultiEdit", "Write"): return {"k": "edit", "d": leaf(inp.get("file_path")), "n": 1}
    if name == "NotebookEdit": return {"k": "edit", "d": leaf(inp.get("notebook_path")), "n": 1}
    if name in ("Grep", "Glob"): return {"k": "search", "d": short(inp.get("pattern"), 200)}
    if name == "WebFetch": return {"k": "web", "d": short(inp.get("url"), 200)}
    if name == "WebSearch": return {"k": "web", "d": short(inp.get("query"), 200)}
    if name in ("Agent", "Task"): return {"k": "agent", "d": short(inp.get("description"), 200)}
    if name in ("TodoWrite", "TaskCreate", "TaskUpdate"): return {"k": "todo", "d": ""}
    if name == "Skill": return {"k": "other", "d": "Skill \u00b7 " + str(inp.get("skill", ""))}
    if name.startswith("mcp__"): return {"k": "other", "d": name[5:].replace("__", " \u00b7 ")}
    return {"k": "other", "d": name}

def claude_user_text(t):
    t = re.sub(r"(?s)<system-reminder>.*?</system-reminder>", "", t)
    m = re.search(r"(?s)The user sent a new message while you were working:\s*\r?\n(.*?)(\r?\n\s*\r?\nThis is how Claude Code surfaces|$)", t)
    if m: return m.group(1)
    m = re.search(r"<command-name>([^<]*)</command-name>", t)
    if m:
        a = re.search(r"(?s)<command-args>(.*?)</command-args>", t)
        return (m.group(1).strip() + " " + (a.group(1).strip() if a else "")).strip()
    m = re.search(r"(?s)<bash-input>(.*?)</bash-input>", t)
    if m: return "! " + m.group(1).strip()
    if re.match(r"^\s*<(local-command-stdout|local-command-caveat|bash-stdout|bash-stderr|task-notification)", t): return ""
    if re.match(r"^\s*\[Image: original", t): return ""
    return t

def parent_map():
    """pid -> parent pid: /proc on Linux, ps elsewhere."""
    parents = {}
    if os.path.isdir("/proc"):
        for d in os.listdir("/proc"):
            if not d.isdigit(): continue
            try:
                with open("/proc/%s/stat" % d) as f: stat = f.read()
                parents[int(d)] = int(stat[stat.rindex(")") + 2:].split()[1])
            except (OSError, ValueError, IndexError): pass
        return parents
    try:
        import subprocess
        for line in subprocess.run(["ps", "-A", "-o", "pid=,ppid="], capture_output=True, text=True).stdout.splitlines():
            a = line.split()
            if len(a) == 2: parents[int(a[0])] = int(a[1])
    except Exception: pass
    return parents

def terminal_pids():
    """The terminal's process and everything under it, nearest first."""
    if not A.pid: return []
    children = {}
    for pid, ppid in parent_map().items(): children.setdefault(ppid, []).append(pid)
    todo, seen = [A.pid], []
    while todo and len(seen) < 200:
        pid = todo.pop(0)
        if pid in seen: continue
        seen.append(pid)
        todo.extend(children.get(pid, []))
    return seen

def command_lines():
    """The command lines running in the terminal: /proc on Linux, ps elsewhere."""
    lines = []
    for pid in terminal_pids():
        try:
            if os.path.isdir("/proc"):
                with open("/proc/%d/cmdline" % pid, "rb") as f: lines.append(f.read().replace(b"\0", b" ").decode("utf-8", "replace"))
            else:
                import subprocess
                lines.append(subprocess.run(["ps", "-o", "args=", "-p", str(pid)], capture_output=True, text=True).stdout)
        except Exception: pass
    return lines

def candidate_cwds():
    """The working folders of the processes running in the terminal, read from /proc."""
    cwds = []
    if A.pid and os.path.isdir("/proc"):
        for pid in terminal_pids():
            try:
                cwd = os.readlink("/proc/%d/cwd" % pid)
                if cwd not in cwds: cwds.append(cwd)
            except OSError: pass
    return cwds or ([A.cwd] if A.cwd else [])

def find_claude():
    sessions = os.path.join(HOME, ".claude", "sessions")
    if not os.path.isdir(sessions): return None
    info = None
    if A.hint:
        try:
            with open(os.path.join(sessions, A.hint + ".json")) as f: info = json.load(f)
        except (OSError, ValueError): info = None
    if not info and A.pid:
        parents = parent_map()
        for fp in glob.glob(os.path.join(sessions, "*.json")):
            try:
                with open(fp) as f: s = json.load(f)
            except (OSError, ValueError): continue
            p = int(s.get("pid") or 0)
            hit = p == A.pid
            for _ in range(8):
                if hit or not p: break
                p = parents.get(p, 0)
                hit = p == A.pid
            if hit:
                info = s
                break
    if not info: return None
    state["hint"] = str(info.get("pid", ""))
    projects = os.path.join(HOME, ".claude", "projects")
    sid = str(info.get("sessionId", ""))
    guess = os.path.join(projects, re.sub(r"[^A-Za-z0-9]", "-", str(info.get("cwd", ""))), sid + ".jsonl")
    if os.path.isfile(guess): return guess
    for fp in glob.glob(os.path.join(projects, "*", sid + ".jsonl")): return fp
    state["waiting"] = "Claude Code hasn't written this conversation yet. Send a message to start it."
    return None

CLAUDE_KEPT = 50

def claude_records(lines):
    """The log's tree nodes in file order: {u: uuid, p: parent, o: the entry if user/assistant, v: shows text}."""
    recs = []
    for line in lines:
        if len(line) < 20 or not line.startswith('{"parentUuid":') or '"isSidechain":true' in line[:300]: continue
        if re.search(r'"type":"(user|assistant)"', line):
            o = loads(line)
            if isinstance(o, dict) and o.get("type") in ("user", "assistant") and o.get("uuid"):
                content = (o.get("message") or {}).get("content")
                shows = isinstance(content, str) or any(isinstance(c, dict) and c.get("type") == "text" for c in content or [])
                recs.append({"u": o["uuid"], "p": o.get("parentUuid") or o.get("logicalParentUuid"), "o": o, "v": shows and not o.get("isMeta")})
                continue
        if '"queued_command"' in line and '"type":"attachment"' in line:
            o = loads(line)
            a = (o or {}).get("attachment") or {}
            if a.get("type") == "queued_command" and a.get("commandMode", "prompt") == "prompt" and (a.get("origin") or {}).get("kind", "human") == "human" and o.get("uuid"):
                said = {"type": "user", "uuid": o["uuid"], "message": {"role": "user", "content": str(a.get("prompt") or "")}}
                recs.append({"u": o["uuid"], "p": o.get("parentUuid") or o.get("logicalParentUuid"), "o": said, "v": bool(str(a.get("prompt") or "").strip())})
                continue
        ids = re.findall(r'"uuid":"([0-9a-f-]{36})"', line)
        if not ids: continue
        parent = re.match(r'\{"parentUuid":(?:null|"([^"]+)")', line).group(1)
        logical = re.search(r'"logicalParentUuid":"([^"]+)"', line)
        recs.append({"u": ids[-1], "p": parent or (logical.group(1) if logical else None), "o": None, "v": False})
    return recs

def claude_branch(recs, known):
    """The live branch through these nodes to the newest one, and the known tail it continues (or None)."""
    by = {r["u"]: r for r in recs}
    if not any(r["o"] is not None for r in recs): return [], known
    path, seen, x = [], set(), recs[-1]
    while x and x["u"] not in seen:
        seen.add(x["u"]); path.append(x); x = by.get(x["p"])
    path.reverse()
    if state["fresh"]: return path, []
    ids = [k[0] for k in known]
    joint = path[0]["p"]
    if joint not in ids: return path, None
    at = ids.index(joint)
    if any(flag == "v" for _, flag in known[at + 1:]): return path, None
    return path, known[:at + 1]

def parse_claude(path):
    lines = read_tail(path)
    known = [k.rsplit(".", 1) for k in A.leaf.split(",") if "." in k]
    recs = claude_records(lines)
    branch, base = claude_branch(recs, known)
    if base is None:
        A.offset = 0
        return parse_claude(path)
    if not branch:
        state["chain"] = A.leaf
        return
    on = {id(r) for r in branch}
    mids = {(r["o"].get("message") or {}).get("id") for r in branch if r["o"] and r["o"].get("type") == "assistant"}
    mids.discard(None)
    for r in recs:
        o = r["o"]
        if o is None: continue
        if id(r) in on or (o.get("type") == "assistant" and (o.get("message") or {}).get("id") in mids): claude_entry(o)
        elif o.get("type") == "user":
            for c in (o.get("message") or {}).get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_result": set_output(str(c.get("tool_use_id", "")), content_text(c.get("content")))
    tail = base + [[r["u"], "v" if r["v"] else "t"] for r in branch]
    state["chain"] = ",".join("%s.%s" % (u, f) for u, f in tail[-CLAUDE_KEPT:])

def claude_entry(o):
        if o.get("isSidechain") or o.get("isMeta") or o.get("isCompactSummary"): return
        content = (o.get("message") or {}).get("content")
        if o["type"] == "user":
            if isinstance(content, str):
                add_message("user", "", claude_user_text(content)); return
            texts = []
            for c in content or []:
                if not isinstance(c, dict): continue
                if c.get("type") == "tool_result": set_output(str(c.get("tool_use_id", "")), content_text(c.get("content")))
                elif c.get("type") == "text":
                    t = claude_user_text(str(c.get("text", "")))
                    if t.strip(): texts.append(t)
                elif c.get("type") == "image": texts.append("[Image attached]")
            if texts: add_message("user", "", "\n".join(texts))
            return
        for c in content or []:
            if not isinstance(c, dict): continue
            if c.get("type") == "text": add_message("assistant", "final", c.get("text"))
            elif c.get("type") == "thinking": add_reasoning(c.get("thinking"))
            elif c.get("type") == "tool_use": add_call(claude_call(str(c.get("name", "")), c.get("input")), str(c.get("id", "")))

Q =r'"((?:[^"\\]|\\.)*)"'

def unquote(s):
    try: return json.loads('"' + s + '"')
    except ValueError: return s

def codex_call(tool, src, whole):
    if tool == "exec_command":
        m = re.search(r'"?cmd"?\s*:\s*' + Q, src)
        return {"k": "shell", "d": short(unquote(m.group(1)), 400) if m else ""}
    if tool == "apply_patch":
        pat = r"\*\*\* (?:Add|Update|Delete) File: (.+?)(?=\\n|\r?\n|\"|`|$)"
        found = re.findall(pat, src) or re.findall(pat, whole)
        files = []
        for f in found:
            name = leaf(f.replace("\\\\", "\\"))
            if name not in files: files.append(name)
        return {"k": "edit", "d": ", ".join(files), "n": max(1, len(files))}
    if tool == "view_image":
        m = re.search(r'"?path"?\s*:\s*' + Q, src)
        return {"k": "image", "d": leaf(unquote(m.group(1))) if m else ""}
    if tool == "web__run":
        m = re.search(r'"?q(?:uery)?"?\s*:\s*' + Q, src)
        return {"k": "web", "d": short(unquote(m.group(1)), 160) if m else ""}
    return {"k": "other", "d": tool}

def codex_output(payload):
    text = content_text(payload.get("output"))
    text = re.sub(r"^Script completed\s*\r?\nWall time[^\n]*\n(Output:\s*\n)?", "", text)
    text = re.sub(r"^Wall time:[^\n]*\n", "", text)
    if text.lstrip().startswith("{") and re.search(r'"(chunk_id|output)":', text):
        outs = [unquote(m) for m in re.findall(r'"output":"((?:[^"\\]|\\.)*)"', text)]
        text = "\n".join(o for o in outs if o.strip())
    return "" if text.strip() == "{}" else text

def iso_ms(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000
    except ValueError: return None

def codex_meta(fp):
    """A Codex log's session_meta payload, or None."""
    try:
        with open(fp, encoding="utf-8") as f: first = json.loads(f.readline())
    except (OSError, ValueError): return None
    return (first.get("payload") or {}) if isinstance(first, dict) and first.get("type") == "session_meta" else None

def codex_own(meta):
    """Whether a log is the person's conversation, not a sub-agent's (such as the approval reviewer's)."""
    return meta is not None and not (isinstance(meta.get("source"), dict) and "subagent" in meta["source"])

def codex_resumed():
    """For `codex resume [id]` in the terminal: (True, the id or None); otherwise (False, None)."""
    for line in command_lines():
        m = re.search(r"(?:^|[\s/'\"])codex['\"]?\s.*?\bresume\b(.*)", line)
        if m:
            uid = re.search(r"\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b", m.group(1))
            return True, uid.group(1) if uid else None
    return False, None

def find_codex():
    root = os.environ.get("CODEX_HOME") or os.path.join(HOME, ".codex")
    sessions = os.path.join(root, "sessions")
    resumed, uid = codex_resumed()
    if uid:
        logs = glob.glob(os.path.join(sessions, "**", "rollout-*%s*.jsonl" % uid), recursive=True)
        if logs: return max(logs, key=os.path.getmtime)
    if A.known and os.path.isfile(A.known) and codex_own(codex_meta(A.known)): return A.known
    if not os.path.isdir(sessions): return None
    since = A.created / 1000 - 10
    cwds = candidate_cwds()
    candidates = [p for p in glob.glob(os.path.join(sessions, "**", "rollout-*.jsonl"), recursive=True) if os.path.getmtime(p) >= since]
    candidates.sort(key=os.path.getmtime, reverse=True)
    later = newest = None
    for fp in candidates:
        p = codex_meta(fp)
        if not codex_own(p) or str(p.get("cwd", "")) not in cwds: continue
        if not newest: newest = fp
        t = iso_ms(str(p.get("timestamp", "")))
        if t is None: continue
        delta = (t - A.created) / 1000
        if abs(delta) <= 8: return fp
        if delta > 0 and not later: later = fp
    return later or (newest if resumed else None)

def parse_codex(path):
    for line in read_tail(path):
        if '"type":"response_item"' not in line: continue
        item = loads(line)
        if not isinstance(item, dict): continue
        p = item.get("payload") or {}
        ptype = str(p.get("type", ""))
        if ptype in ("custom_tool_call", "function_call"):
            tool = str(p.get("name", ""))
            src = str(p.get("input" if ptype == "custom_tool_call" else "arguments") or "")
            calls = []
            if tool == "exec":
                found = list(re.finditer(r"(?<![\w.])tools\.(exec_command|apply_patch|view_image|write_stdin|web__run|\w+__\w+)\s*\(", src))
                for i, m in enumerate(found):
                    end = found[i + 1].start() if i + 1 < len(found) else len(src)
                    calls.append(codex_call(m.group(1), src[m.start():end], src))
                if not calls: calls.append({"k": "other", "d": "script"})
            elif tool:
                calls.append(codex_call(tool, src, src))
            for i, c in enumerate(calls):
                add_call(c, str(p.get("call_id", "")) if i == len(calls) - 1 else "")
            continue
        if ptype in ("custom_tool_call_output", "function_call_output"):
            set_output(str(p.get("call_id", "")), codex_output(p)); continue
        if ptype == "reasoning":
            add_reasoning("\n\n".join(str(s.get("text", "")) for s in p.get("summary") or [] if isinstance(s, dict))); continue
        if ptype != "message": continue
        role = str(p.get("role", ""))
        if role not in ("user", "assistant"): continue
        phase = str(p.get("phase", "") or "")
        if role == "assistant" and phase not in ("final", "final_answer", "commentary"): continue
        body = content_text(p.get("content")).strip()
        if role == "user":
            if re.match(r"^<(environment_context|user_instructions|permissions)", body) or body.startswith("# AGENTS.md"): continue
            body = re.sub(r'<image\s+name=\[Image #\d+\]\s+path="[^"]+">', "[Image attached]", body)
            body = re.sub(r"\s*\[Image #\d+\]", "", body.replace("</image>", ""))
        add_message(role, phase, body)

def pi_call(name, inp):
    inp = inp if isinstance(inp, dict) else {}
    if name == "bash": return {"k": "shell", "d": short(inp.get("command"), 400)}
    if name == "read":
        p = str(inp.get("path", ""))
        return {"k": "image" if re.search(r"\.(png|jpe?g|gif|webp)$", p, re.I) else "read", "d": leaf(p)}
    if name in ("edit", "write"): return {"k": "edit", "d": leaf(inp.get("path")), "n": 1}
    if name in ("grep", "find", "ls"): return {"k": "search", "d": short(inp.get("pattern") or inp.get("path"), 200)}
    return {"k": "other", "d": name}

def find_pi():
    since = A.created / 1000 - 10
    files = []
    for cwd in candidate_cwds():
        folder = os.path.join(HOME, ".pi", "agent", "sessions", "--" + re.sub(r"[\\/:]", "-", cwd.lstrip("\\/")) + "--")
        files += [(os.path.getmtime(fp), fp) for fp in glob.glob(os.path.join(folder, "*.jsonl"))]
    files = [f for f in files if f[0] >= since]
    if not files: return None
    newest = max(files)
    if A.known and newest[1] == A.known: return A.known
    if A.screen:
        screen = words_of(A.screen)
        hits = [f for f in files if shown_on(f[1], screen)]
        return max(hits)[1] if hits else None
    if len(files) > 1 or A.peers:
        state["need"] = "screen"
        return None
    return newest[1]

def words_of(text):
    """Lower-case words only, so markdown, wrapping and terminal drawing don't matter."""
    return " ".join(re.sub(r"[^0-9A-Za-z]+", " ", text).lower().split())

def shown_on(path, screen):
    """Whether one of the file's last few messages shows on the screen: its first or last words."""
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 262144))
            lines = f.read().decode("utf-8", "replace").split("\n")
    except OSError: return False
    texts = []
    for line in reversed(lines):
        if '"type":"message"' not in line: continue
        o = loads(line)
        m = (o or {}).get("message") or {}
        if m.get("role") not in ("user", "assistant"): continue
        text = content_text(m.get("content"))
        if text.strip(): texts.append(text)
        if len(texts) >= 3: break
    for text in texts:
        w = words_of(text).split()
        if len(w) < 3: continue
        for part in (w[:6], w[-6:]):
            if " ".join(part) in screen: return True
    return False

def parse_pi(path):
    since = A.created - 10000 if A.created else 0
    for line in read_tail(path):
        if '"type":"message"' not in line: continue
        o = loads(line)
        if not isinstance(o, dict): continue
        stamp = iso_ms(str(o.get("timestamp", "")))
        if since and stamp is not None and stamp < since: continue
        m = o.get("message") or {}
        role = m.get("role")
        content = m.get("content") or []
        if role == "user":
            parts = []
            for c in content if isinstance(content, list) else []:
                if isinstance(c, dict) and c.get("type") == "text": parts.append(str(c.get("text", "")))
                elif isinstance(c, dict) and c.get("type") == "image": parts.append("[Image attached]")
            add_message("user", "", "\n".join(parts) if parts else content_text(content))
        elif role == "assistant":
            for c in content if isinstance(content, list) else []:
                if not isinstance(c, dict): continue
                if c.get("type") == "text": add_message("assistant", "final", c.get("text"))
                elif c.get("type") == "thinking": add_reasoning(c.get("thinking"))
                elif c.get("type") == "toolCall": add_call(pi_call(str(c.get("name", "")), c.get("arguments")), str(c.get("id", "")))
        elif role == "toolResult":
            set_output(str(m.get("toolCallId", "")), "\n".join(str(c.get("text", "")) for c in content if isinstance(c, dict) and c.get("type") == "text"))

LABELS = {"claude-code": "Claude Code", "codex": "Codex", "pi": "Pi"}
label = LABELS.get(A.app)
if not label: done("Chat view doesn't read %s sessions yet." % A.app)
path = {"claude-code": find_claude, "codex": find_codex, "pi": find_pi}[A.app]()
if not path and state["need"]: emit("NEED|" + state["need"]); done("Finding this %s conversation…" % label)
if not path: done(state["waiting"] or "Waiting for this %s conversation to start." % label)
{"claude-code": parse_claude, "codex": parse_codex, "pi": parse_pi}[A.app](path)
emit("PATH|" + esc(path))
emit("HINT|" + esc(state["hint"]))
emit("OFFSET|%d" % state["next"])
if state["chain"] is not None: emit("LEAF|" + esc(state["chain"]))
if state["fresh"]: emit("RESET")
if state["clipped"]: emit("NOTE|" + esc("Showing the recent part of this session."))
if state["fresh"] and not entries: emit("NOTE|" + esc("No messages in this session yet."))
for e in (entries[-MAX_ENTRIES:] if state["fresh"] else entries):
    k = e["kind"]
    if k == "call": emit("C|" + esc(e["id"]) + "|" + esc(json.dumps(e["call"], separators=(",", ":"), ensure_ascii=False)))
    elif k == "out": emit("O|" + esc(e["id"]) + "|" + esc(e["text"]))
    elif k == "reasoning": emit("R|" + esc(e["text"]))
    else: emit("M|" + e["role"] + "|" + e["phase"] + "|" + esc(e["text"]))
flush()
