import json, os, sqlite3, subprocess, sys, tempfile, urllib.parse
from reader_bundle import bundle

reader = bundle()
failed = 0

def check(name, got, want):
    global failed
    ok = got == want
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else ": got %r" % (got,)))
    if not ok: failed += 1

def make_db(data_home, rows):
    """An OpenCode database with the tables the reader uses, holding `rows` (sessions and their messages)."""
    os.makedirs(os.path.join(data_home, "opencode"), exist_ok=True)
    con = sqlite3.connect(os.path.join(data_home, "opencode", "opencode.db"))
    con.execute("create table session_v2 (id text primary key, directory text, parent_id text, time_created integer, time_updated integer)")
    con.execute("create table session_message (id text primary key, session_id text, type text, seq integer, data text)")
    for sid, directory, created, updated, messages in rows:
        con.execute("insert into session_v2 values (?, ?, null, ?, ?)", (sid, directory, created, updated))
        for seq, (kind, data) in enumerate(messages):
            con.execute("insert into session_message values (?, ?, ?, ?, ?)", ("%s-%d" % (sid, seq), sid, kind, seq, json.dumps(data)))
    con.commit(); con.close()

def read(data_home, cwd, created, known=""):
    """The reader's tagged output for an OpenCode terminal in `cwd`, as (tag, fields) pairs."""
    args = [sys.executable, "-I", str(reader), "--app", "opencode", "--label", "OpenCode", "--created", str(created), "--cwd", cwd]
    if known: args += ["--known", known]
    out = subprocess.run(args, capture_output=True, text=True, env={**os.environ, "XDG_DATA_HOME": data_home}).stdout
    return [(l.split("|")[0], [urllib.parse.unquote(x) for x in l.split("|")[1:]]) for l in out.splitlines() if l]

home = tempfile.mkdtemp()
tool = {"type": "tool", "id": "c1", "name": "shell", "state": {"input": {"command": "ls"}, "content": [{"type": "text", "text": "a.txt\n"}]}}
make_db(home, [
    ("old", "/work", 1000, 2000, [("user", {"text": "from before the terminal"})]),
    ("new", "/work", 50000, 60000, [
        ("user", {"text": "list the files", "files": []}),
        ("assistant", {"content": [{"type": "reasoning", "text": ""}, tool, {"type": "reasoning", "text": "one file"}]}),
        ("assistant", {"content": [{"type": "text", "text": "There's a.txt."}]}),
        ("idle", {"outcome": "succeeded"}),
    ]),
    ("elsewhere", "/other", 50000, 70000, [("user", {"text": "not this folder"})]),
])
db = os.path.join(home, "opencode", "opencode.db")
out = read(home, "/work", 55000)
check("the session started in the terminal's folder after it opened is read", [f for t, f in out if t == "PATH"], [[db + "#new"]])
check("messages, a tool call with its output, and reasoning come through in order",
      [(t, f[-1]) for t, f in out if t in ("M", "C", "O", "R")],
      [("M", "list the files"), ("C", json.dumps({"k": "shell", "d": "ls"}, separators=(",", ":"))), ("O", "a.txt"), ("R", "one file"), ("M", "There's a.txt.")])
check("every read is whole, since replies update in place", [t for t, f in out if t == "RESET"], ["RESET"])
check("a session the chat already knows is kept", [f for t, f in read(home, "/work", 1, known=db + "#old") if t == "PATH"], [[db + "#old"]])
check("no session yet: waiting", [f for t, f in read(home, "/nowhere", 90000) if t == "NOTE"], [["Waiting for this OpenCode conversation to start."]])
check("none in its folder, others updated since: asks for the screen first", [t for t, f in read(home, "/nowhere", 55000) if t == "NEED"], ["NEED"])
check("no OpenCode database: waiting too", [f for t, f in read(tempfile.mkdtemp(), "/work", 55000) if t == "NOTE"], [["Waiting for this OpenCode conversation to start."]])
sys.exit(1 if failed else 0)
