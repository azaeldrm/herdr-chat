import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.parse
from pathlib import Path
from reader_bundle import bundle

# Which session is the terminal's, as Pi and OpenCode find it (common.py pick_session): written since the agent started,
# in the terminal's folders first; then any folder, which the screen must confirm; the screen also tells several apart.
reader = bundle()
failed = 0

def check(name, got, want):
    global failed
    ok = got == want
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else ": got %r, want %r" % (got, want)))
    if not ok: failed += 1

def read(app, env, cwd, created, known="", screen=None, peers=0):
    """(the session the reader picked, whether it asked for the screen)."""
    args = [sys.executable, "-I", str(reader), "--app", app, "--created", str(int(created * 1000)), "--cwd", cwd]
    if known: args += ["--known", known]
    if screen is not None: args += ["--screen", screen]
    if peers: args += ["--peers", str(peers)]
    out = subprocess.run(args, capture_output=True, text=True, env={**os.environ, **env}).stdout.splitlines()
    path = next((urllib.parse.unquote(l[5:]) for l in out if l.startswith("PATH|")), "")
    return path, "NEED|screen" in out

now = time.time()

# Pi: a folder of sessions per working folder.
home = tempfile.mkdtemp()
env = {"HOME": home, "USERPROFILE": home}
def pi_session(cwd, name, said, mtime):
    folder = Path(home, ".pi", "agent", "sessions", "--" + cwd.strip("/").replace("/", "-") + "--")
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_text(json.dumps({"type": "message", "message": {"role": "assistant", "content": [{"type": "text", "text": said}]}}, separators=(",", ":")) + "\n")
    os.utime(path, (mtime, mtime))
    return str(path)

started = now - 100
pi_session("/work", "old.jsonl", "from a day before the terminal opened", now - 86400)
one = pi_session("/work", "one.jsonl", "the first session in this terminal is here", now - 50)
check("Pi: the one session written since it started", read("pi", env, "/work", started), (one, False))
check("Pi: other Pi agents on this machine, so the screen decides", read("pi", env, "/work", started, peers=1), ("", True))
two = pi_session("/work", "two.jsonl", "a second session written here more recently", now - 20)
check("Pi: two written since, so it asks for the screen", read("pi", env, "/work", started), ("", True))
check("Pi: the one the screen shows", read("pi", env, "/work", started, screen="> the first session in this terminal is here")[0], one)
check("Pi: a remembered session that is still the newest is kept", read("pi", env, "/work", started, known=two)[0], two)
moved = pi_session("/elsewhere", "resumed.jsonl", "a conversation resumed from another folder", now - 10)
check("Pi: nothing in its folder, one elsewhere: the screen must confirm", read("pi", env, "/empty", started), ("", True))
check("Pi: resumed from another folder, shown on the screen", read("pi", env, "/empty", started, screen="a conversation resumed from another folder")[0], moved)
check("Pi: elsewhere but not on the screen: not this terminal's", read("pi", env, "/empty", started, screen="nothing like it here at all")[0], "")

# OpenCode: one SQLite file; a resumed session is updated, not created, after the terminal opened.
data = tempfile.mkdtemp()
os.makedirs(os.path.join(data, "opencode"))
db = os.path.join(data, "opencode", "opencode.db")
con = sqlite3.connect(db)
con.execute("create table session_v2 (id text primary key, directory text, parent_id text, time_created integer, time_updated integer)")
con.execute("create table session_message (id text primary key, session_id text, type text, seq integer, data text)")
ms = lambda t: int(t * 1000)
for sid, directory, created, updated, said in [
    ("resumed-here", "/work", now - 86400, now - 30, "picked up again in this folder"),
    ("resumed-away", "/away", now - 86400, now - 20, "picked up again from another folder"),
    ("idle", "/away", now - 86400, now - 86000, "untouched since yesterday"),
]:
    con.execute("insert into session_v2 values (?, ?, null, ?, ?)", (sid, directory, ms(created), ms(updated)))
    con.execute("insert into session_message values (?, ?, 'assistant', 0, ?)", (sid + "-0", sid, json.dumps({"content": [{"type": "text", "text": said}]})))
con.commit()
env = {"XDG_DATA_HOME": data}
check("OpenCode: a session resumed in its folder (updated since, created long before)", read("opencode", env, "/work", started), (db + "#resumed-here", False))
check("OpenCode: nothing in its folder, resumed elsewhere: the screen must confirm", read("opencode", env, "/empty", started), ("", True))
check("OpenCode: resumed elsewhere, shown on the screen", read("opencode", env, "/empty", started, screen="picked up again from another folder")[0], db + "#resumed-away")
con.execute("insert into session_v2 values ('newer', '/work', null, ?, ?)",(ms(now - 60), ms(now - 5)))
con.execute("insert into session_message values ('newer-0', 'newer', 'user', 0, ?)", (json.dumps({"text": "a newer session in the same folder"}),))
con.commit(); con.close()
check("OpenCode: two in its folder with other OpenCode agents: the one the screen shows, not just the newest",
      read("opencode", env, "/work", started, screen="picked up again in this folder", peers=1)[0], db + "#resumed-here")

sys.exit(1 if failed else 0)
