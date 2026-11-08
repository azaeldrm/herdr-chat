import sqlite3

def opencode_db():
    """Where OpenCode keeps its sessions: one SQLite file under the data folder."""
    base = os.environ.get("XDG_DATA_HOME") or os.path.join(HOME, ".local", "share")
    return os.path.join(base, "opencode", "opencode.db")

def opencode_open(db):
    """The database opened read-only, or None when it can't be."""
    try:
        con = sqlite3.connect("file:%s?mode=ro" % quote(db, safe="/:\\"), uri=True, timeout=2)
        con.execute("select 1 from session_v2 limit 1")
        return con
    except sqlite3.Error:
        return None

def opencode_call(name, inp):
    inp = inp if isinstance(inp, dict) else {}
    path = inp.get("path") or inp.get("filePath") or inp.get("file_path")
    if name in ("shell", "bash"): return {"k": "shell", "d": short(inp.get("command"), 400)}
    if name == "read":
        return {"k": "image" if re.search(r"\.(png|jpe?g|gif|webp)$", str(path or ""), re.I) else "read", "d": leaf(path)}
    if name in ("edit", "write", "patch", "multiedit"): return {"k": "edit", "d": leaf(path), "n": 1}
    if name in ("grep", "glob", "list", "ls", "find"): return {"k": "search", "d": short(inp.get("pattern") or path, 200)}
    if name in ("webfetch", "websearch"): return {"k": "web", "d": short(inp.get("url") or inp.get("query"), 200)}
    if name in ("todowrite", "todoread"): return {"k": "todo", "d": ""}
    if name == "task": return {"k": "agent", "d": short(inp.get("description"), 200)}
    return {"k": "other", "d": name}

def find_opencode():
    db = opencode_db()
    if not os.path.exists(db): return None
    con = opencode_open(db)
    if con is None:
        state["waiting"] = "This OpenCode keeps sessions in a format the chat doesn't read yet."
        return None
    if A.known.startswith(db + "#"):
        sid = A.known.split("#", 1)[1]
        if con.execute("select 1 from session_v2 where id = ?", (sid,)).fetchone(): return A.known
    since = A.created - 10000 if A.created else 0
    cwds = candidate_cwds() or ([A.cwd] if A.cwd else [])
    rows = []
    for cwd in cwds:
        rows += con.execute("select time_updated, id from session_v2 where directory = ? and parent_id is null and time_created >= ?", (cwd, since)).fetchall()
    if not rows: return None
    if len(rows) > 1 and A.peers:
        state["need"] = "screen"
        if not A.screen: return None
    return db + "#" + max(rows)[1]

def parse_opencode(path):
    db, sid = path.split("#", 1)
    con = opencode_open(db)
    if con is None: return
    state["next"] = 0
    rows = con.execute("select type, data from (select type, data, seq from session_message where session_id = ? order by seq desc limit ?) order by seq", (sid, MAX_ENTRIES)).fetchall()
    for kind, data in rows:
        d = loads(data)
        if not isinstance(d, dict): continue
        if kind == "user":
            text = str(d.get("text", ""))
            if d.get("files"): text = (text + "\n[Image attached]").strip()
            add_message("user", "", text)
        elif kind == "assistant":
            for c in d.get("content") or []:
                if not isinstance(c, dict): continue
                if c.get("type") == "text": add_message("assistant", "final", c.get("text"))
                elif c.get("type") == "reasoning": add_reasoning(c.get("text"))
                elif c.get("type") == "tool":
                    cid = str(c.get("id", ""))
                    st = c.get("state") or {}
                    add_call(opencode_call(str(c.get("name", "")), st.get("input")), cid)
                    out = "\n".join(str(x.get("text", "")) for x in st.get("content") or [] if isinstance(x, dict) and x.get("type") == "text")
                    if out: set_output(cid, out)

READERS["opencode"] = (find_opencode, parse_opencode)
