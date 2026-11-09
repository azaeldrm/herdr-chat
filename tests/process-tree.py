import json, os, subprocess, sys, tempfile
from pathlib import Path
from reader_bundle import bundle

"""A Claude Code session is found from the terminal's process, whichever process in it wrote the session record."""

SID = "11111111-2222-3333-4444-555555555555"
failures = []

def check(name, ok):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok: failures.append(name)

with tempfile.TemporaryDirectory() as home:
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    try:
        sessions = Path(home) / ".claude" / "sessions"
        project = Path(home) / ".claude" / "projects" / "-work"
        sessions.mkdir(parents=True)
        project.mkdir(parents=True)
        log = project / (SID + ".jsonl")
        log.write_text(json.dumps({"type": "user", "uuid": "u1", "message": {"role": "user", "content": "hello"}}) + "\n", encoding="utf-8")
        (sessions / (str(child.pid) + ".json")).write_text(json.dumps({"pid": child.pid, "sessionId": SID, "cwd": "/work"}), encoding="utf-8")
        env = dict(os.environ, HOME=home, USERPROFILE=home)
        script = str(bundle())
        try:
            def read(pid):
                return subprocess.run([sys.executable, script, "--app", "claude-code", "--pid", str(pid)], env=env, capture_output=True, text=True, encoding="utf-8")
            r = read(os.getpid())
            check("the reader runs", r.returncode == 0)
            check("a session is found from its parent process", any(l.startswith("PATH|") and l != "PATH|" for l in r.stdout.splitlines()))
            r = read(child.pid)
            check("a session is found from its own process", any(l.startswith("PATH|") and l != "PATH|" for l in r.stdout.splitlines()))
        finally:
            os.unlink(script)
    finally:
        child.kill()
        child.wait()

sys.exit(1 if failures else 0)
