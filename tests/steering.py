import json, os, subprocess, sys, tempfile, urllib.parse
from pathlib import Path

from reader_bundle import bundle
reader = bundle()

def entry(kind, uuid, parent, **rest):
    uuid, parent = U[uuid], (U[parent] if parent else None)
    return json.dumps({"parentUuid": parent, "isSidechain": False, "type": kind, "uuid": uuid, **rest}, separators=(",", ":"))

U = {k: f"00000000-0000-4000-8000-{i:012d}" for i, k in enumerate(["u1", "a1", "q1", "e1", "q2", "a2"])}
log = [
    entry("user", "u1", None, message={"role": "user", "content": "Run sleep 20, then say finished."}),
    entry("assistant", "a1", "u1", message={"role": "assistant", "content": [{"type": "text", "text": "Running it."}]}),
    entry("attachment", "q1", "a1", attachment={"type": "queued_command", "prompt": "Also add the word steered.", "commandMode": "prompt", "origin": {"kind": "human"}, "humanTurn": True}),
    entry("attachment", "e1", "q1", attachment={"type": "environment", "text": "not a message"}),
    entry("attachment", "q2", "e1", attachment={"type": "queued_command", "prompt": "/compact", "commandMode": "bash", "origin": {"kind": "human"}}),
    entry("assistant", "a2", "q2", message={"role": "assistant", "content": [{"type": "text", "text": "finished steered"}]}),
]
with tempfile.TemporaryDirectory() as home:
    os.makedirs(os.path.join(home, ".claude", "sessions"))
    os.makedirs(os.path.join(home, ".claude", "projects", "-work"))
    Path(home, ".claude", "sessions", "4242.json").write_text(json.dumps({"pid": 4242, "sessionId": "s1", "cwd": "/work"}))
    Path(home, ".claude", "projects", "-work", "s1.jsonl").write_text("\n".join(log) + "\n")
    out = subprocess.run([sys.executable, "-I", str(reader), "--app", "claude-code", "--pid", "4242", "--cwd", "/work"],
                         capture_output=True, text=True, env={**os.environ, "HOME": home}).stdout
said = [(l.split("|", 3)[1], urllib.parse.unquote(l.split("|", 3)[3])) for l in out.splitlines() if l.startswith("M|")]
want = [("user", "Run sleep 20, then say finished."), ("assistant", "Running it."), ("user", "Also add the word steered."), ("assistant", "finished steered")]
if said != want:
    sys.exit(f"FAIL: the chat would show\n  {said}\nnot\n  {want}")
print("PASS a steer shows in its place; other attachments and non-prompt queued commands don't")
