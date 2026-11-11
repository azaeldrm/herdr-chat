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
    # Pi keeps a folder of sessions per working folder: the terminal's folders first, then (a session resumed from another
    # folder's) any folder, which the screen must confirm.
    sessions = os.path.join(HOME, ".pi", "agent", "sessions")
    own = []
    for cwd in candidate_cwds():
        own += glob.glob(os.path.join(sessions, "--" + re.sub(r"[\\/:]", "-", cwd.lstrip("\\/")) + "--", "*.jsonl"))
    files = written_since_start(own)
    confirm = not files
    if confirm: files = written_since_start(glob.glob(os.path.join(sessions, "*", "*.jsonl")))
    if not files: return None
    if A.known and files[0] == A.known: return A.known
    return pick_session(files, log_texts(pi_message), confirm)

def pi_message(line):
    """A Pi log line's message text from the person or Pi, or None."""
    if '"type":"message"' not in line: return None
    m = (loads(line) or {}).get("message") or {}
    return content_text(m.get("content")) if m.get("role") in ("user", "assistant") else None

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
            said = re.sub(r'(?s)<skill name="([^"]+)"[^>]*>.*?</skill>\s*', r"/skill:\1 ", content_text(content))
            add_message("user", "", *placed_images(said))
            add_tick(iso_time(o.get("timestamp")), prompt=True)
        elif role == "assistant":
            # The reply's request started at its message's timestamp (ms) and ended at its entry's.
            if isinstance(m.get("timestamp"), (int, float)): add_tick(m["timestamp"] / 1000)
            add_tick(iso_time(o.get("timestamp")), mid=str(o.get("id") or m.get("responseId") or stamp), out=(m.get("usage") or {}).get("output"))
            for c in content if isinstance(content, list) else []:
                if not isinstance(c, dict): continue
                if c.get("type") == "text": add_message("assistant", "final", c.get("text"))
                elif c.get("type") == "thinking": add_reasoning(c.get("thinking"))
                elif c.get("type") == "toolCall": add_call(pi_call(str(c.get("name", "")), c.get("arguments")), str(c.get("id", "")))
        elif role == "toolResult":
            add_tick(iso_time(o.get("timestamp")))
            set_output(str(m.get("toolCallId", "")), "\n".join(str(c.get("text", "")) for c in content if isinstance(c, dict) and c.get("type") == "text"))

READERS["pi"] = (find_pi, parse_pi)
