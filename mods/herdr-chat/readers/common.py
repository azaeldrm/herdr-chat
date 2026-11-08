import argparse, glob, json, os, re, sys
from datetime import datetime, timezone
from urllib.parse import quote

ap = argparse.ArgumentParser()
ap.add_argument("--app", required=True)
ap.add_argument("--label", default="")
ap.add_argument("--pid", type=int, default=0)
ap.add_argument("--created", type=int, default=0)
ap.add_argument("--cwd", default="")
ap.add_argument("--known", default="")
ap.add_argument("--hint", default="")
ap.add_argument("--offset", type=int, default=0)
ap.add_argument("--screen", default="")
ap.add_argument("--peers", type=int, default=0)
ap.add_argument("--leaf", default="")
ap.add_argument("--tail", type=int, default=24)
ap.add_argument("--entries", type=int, default=400)
A = ap.parse_args()

HOME = os.path.expanduser("~")
ELLIPSIS = "\u2026"
MAX_ENTRIES = A.entries
TAIL = A.tail * 1024 * 1024
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

def belongs(pid):
    """Whether a process is the terminal's own or one of its descendants."""
    parents = None
    for _ in range(9):
        if not pid: return False
        if pid == A.pid: return True
        if os.path.isdir("/proc"):
            try:
                with open("/proc/%d/stat" % pid) as f: stat = f.read()
                pid = int(stat[stat.rindex(")") + 2:].split()[1])
            except (OSError, ValueError, IndexError): return False
        else:
            parents = parents if parents is not None else parent_map()
            pid = parents.get(pid, 0)
    return False

def iso_ms(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000
    except ValueError: return None

READERS = {}
