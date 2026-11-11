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

def codex_talked(fp):
    """Whether a log has any of the conversation in it, rather than only its session_meta and settings."""
    try:
        with open(fp, "rb") as f:
            for line in f:
                if b'"type":"response_item"' in line: return True
    except OSError: pass
    return False

def find_codex():
    root = os.environ.get("CODEX_HOME") or os.path.join(HOME, ".codex")
    sessions = os.path.join(root, "sessions")
    resumed, uid = codex_resumed()
    if uid:
        logs = glob.glob(os.path.join(sessions, "**", "rollout-*%s*.jsonl" % uid), recursive=True)
        if logs: return max(logs, key=os.path.getmtime)
    if A.known and os.path.isfile(A.known) and codex_own(codex_meta(A.known)) and codex_talked(A.known): return A.known
    if not os.path.isdir(sessions): return None
    cwds = candidate_cwds()
    candidates = written_since_start(glob.glob(os.path.join(sessions, "**", "rollout-*.jsonl"), recursive=True))
    found = later = newest = None
    for fp in candidates:
        p = codex_meta(fp)
        if not codex_own(p) or str(p.get("cwd", "")) not in cwds: continue
        if not newest: newest = fp
        t = iso_ms(str(p.get("timestamp", "")))
        if t is None: continue
        delta = (t - A.created) / 1000
        if abs(delta) <= 8: found = fp; break
        if delta > 0 and not later: later = fp
    found = found or later or (newest if resumed else None)
    if found and codex_talked(found): return found
    return codex_picked(candidates, found)

def codex_message(line):
    """A Codex log line's message text from the person or Codex, or None."""
    if '"type":"response_item"' not in line or '"type":"message"' not in line: return None
    p = (loads(line) or {}).get("payload") or {}
    return content_text(p.get("content")) if p.get("type") == "message" and p.get("role") in ("user", "assistant") else None

def codex_picked(candidates, launch):
    """A conversation resumed from inside Codex (its /resume picker): Codex starts an empty log at launch, then writes on in the
    picked conversation's own log, whose session_meta has that conversation's folder. So: a log of the person's written
    since the agent started, in any folder, that the screen confirms; the launch log meanwhile, or when none is shown."""
    others = [fp for fp in candidates if fp != launch and codex_own(codex_meta(fp)) and codex_talked(fp)]
    return pick_session(others, log_texts(codex_message), confirm=True) or launch

def codex_runs_with(lines):
    """What the session runs with, from its newest turn_context (model, effort, sandbox; the approval reviewer's turns left
    out) and token_count (context used of the model's window)."""
    meta = state["meta"]
    for line in reversed(lines):
        if "model" not in meta and '"turn_context"' in line:
            p = (loads(line) or {}).get("payload") or {}
            if str(p.get("model", "")).startswith("codex-auto-review"): continue
            meta["model"] = p.get("model")
            meta["effort"] = p.get("effort") or ((p.get("collaboration_mode") or {}).get("settings") or {}).get("reasoning_effort")
            meta["mode"] = (p.get("sandbox_policy") or {}).get("type")
        if "context" not in meta and '"token_count"' in line:
            info = ((loads(line) or {}).get("payload") or {}).get("info") or {}
            last = info.get("last_token_usage") or {}
            if last.get("input_tokens") is not None:
                meta["context"] = int(last.get("input_tokens") or 0)
                if info.get("model_context_window"): meta["window"] = int(info["model_context_window"])
        if "model" in meta and "context" in meta: break
    if state["fresh"]:
        # The models it offers, with their efforts, from its own list (read once, when the log is read from the start).
        root = os.environ.get("CODEX_HOME") or os.path.join(HOME, ".codex")
        try:
            with open(os.path.join(root, "models_cache.json"), encoding="utf-8") as f: cache = json.load(f)
            meta["models"] = [{"id": m.get("slug"), "name": m.get("display_name") or m.get("slug"),
                               "efforts": [l.get("effort") for l in m.get("supported_reasoning_levels") or [] if l.get("effort")]}
                              for m in cache.get("models") or [] if m.get("visibility") == "list" and m.get("slug")]
        except (OSError, ValueError, AttributeError): pass

def parse_codex(path):
    lines = read_tail(path)
    codex_runs_with(lines)
    for line in lines:
        if '"token_count"' in line:
            # One model request done: its output tokens, keyed by the running total (Codex repeats a count at times).
            o = loads(line) or {}
            info = (o.get("payload") or {}).get("info") or {}
            total = (info.get("total_token_usage") or {}).get("total_tokens")
            if total is not None:
                add_tick(iso_time(o.get("timestamp")), mid=f"t{total}", out=(info.get("last_token_usage") or {}).get("output_tokens"))
            continue
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
            set_output(str(p.get("call_id", "")), codex_output(p)); add_tick(iso_time(item.get("timestamp"))); continue
        if ptype == "reasoning":
            add_reasoning("\n\n".join(str(s.get("text", "")) for s in p.get("summary") or [] if isinstance(s, dict))); continue
        if ptype != "message": continue
        role = str(p.get("role", ""))
        if role not in ("user", "assistant"): continue
        phase = str(p.get("phase", "") or "")
        if role == "assistant" and phase not in ("final", "final_answer", "commentary"): continue
        body = content_text(p.get("content")).strip()
        if role == "user":
            if re.match(r"^<(environment_context|user_instructions|permissions|skill>)", body) or body.startswith("# AGENTS.md"): continue
            text, images = placed_images(body)
            add_message(role, phase, re.sub(r'<image\s+name=\[Image #\d+\]\s+path="[^"]*">\s*(?:</image>)?\s*', "", text), images)
            add_tick(iso_time(item.get("timestamp")), prompt=True); continue
        add_message(role, phase, body)

def codex_listed_skills(path):
    """The skills Codex told its model about, from the newest list in its log."""
    found = []
    for line in log_lines(path, b"skills_instructions"):
        p = (loads(line) or {}).get("payload") or {}
        if p.get("role") != "developer": continue
        for c in p.get("content") or []:
            text = str(c.get("text", "")) if isinstance(c, dict) else ""
            if "<skills_instructions>" in text:
                found = [(n, d, "") for n, d in re.findall(r"(?m)^- ([^:\n]+): (.*?)(?: \(file: [^)]*\))?$", text.split("</skills_instructions>")[0])]
    return found

SKILL_LOGS["codex"] = codex_listed_skills

READERS["codex"] = (find_codex, parse_codex)
