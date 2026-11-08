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
    t = re.sub(r'<pasted_content id="[^"]*">\r?\n?|\r?\n?</pasted_content id="[^"]*">', "", t)
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

def find_claude():
    sessions = os.path.join(HOME, ".claude", "sessions")
    if not os.path.isdir(sessions): return None
    info = None
    if A.hint:
        try:
            with open(os.path.join(sessions, A.hint + ".json")) as f: info = json.load(f)
        except (OSError, ValueError): info = None
        if info and A.pid and not belongs(int(info.get("pid") or 0)): info = None
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
                add_message("user", "", *placed_images(claude_user_text(content))); return
            texts = []
            for c in content or []:
                if not isinstance(c, dict): continue
                if c.get("type") == "tool_result": set_output(str(c.get("tool_use_id", "")), content_text(c.get("content")))
                elif c.get("type") == "text":
                    t = claude_user_text(str(c.get("text", "")))
                    if t.strip(): texts.append(t)
            add_message("user", "", *placed_images("\n".join(texts)))
            return
        for c in content or []:
            if not isinstance(c, dict): continue
            if c.get("type") == "text": add_message("assistant", "final", c.get("text"))
            elif c.get("type") == "thinking": add_reasoning(c.get("thinking"))
            elif c.get("type") == "tool_use": add_call(claude_call(str(c.get("name", "")), c.get("input")), str(c.get("id", "")))

READERS["claude-code"] = (find_claude, parse_claude)

def claude_listed_skills(path):
    """The skills Claude Code told its model about, built-in and plugin ones too; a name's newest description wins."""
    found = {}
    for line in log_lines(path, b'"skill_listing"'):
        a = (loads(line) or {}).get("attachment") or {}
        if a.get("type") != "skill_listing": continue
        descs = dict(re.findall(r"(?m)^- ([^:\n]+(?::[^:\s]+)?): (.*)$", str(a.get("content", ""))))
        for name in a.get("names") or []: found[name] = (name, descs.get(name, ""), "")
    return list(found.values())

SKILL_LOGS["claude-code"] = claude_listed_skills
