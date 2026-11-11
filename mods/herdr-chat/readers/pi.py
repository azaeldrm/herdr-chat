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

def pi_message(line):
    """A Pi log line's message text from the person or Pi, or None."""
    if '"type":"message"' not in line: return None
    m = (loads(line) or {}).get("message") or {}
    return content_text(m.get("content")) if m.get("role") in ("user", "assistant") else None

def shown_on(path, screen):
    """Whether one of the file's last few messages shows on the screen."""
    return any_shown(last_texts(path, pi_message), screen)

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
        elif role == "assistant":
            for c in content if isinstance(content, list) else []:
                if not isinstance(c, dict): continue
                if c.get("type") == "text": add_message("assistant", "final", c.get("text"))
                elif c.get("type") == "thinking": add_reasoning(c.get("thinking"))
                elif c.get("type") == "toolCall": add_call(pi_call(str(c.get("name", "")), c.get("arguments")), str(c.get("id", "")))
        elif role == "toolResult":
            set_output(str(m.get("toolCallId", "")), "\n".join(str(c.get("text", "")) for c in content if isinstance(c, dict) and c.get("type") == "text"))

READERS["pi"] = (find_pi, parse_pi)
