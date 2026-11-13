import json, os, subprocess, sys, tempfile
from pathlib import Path
from urllib.parse import unquote
from reader_bundle import bundle

"""A Claude Code session is found under the CLAUDE_CONFIG_DIR its process was started with, and under ~/.claude without one."""

failures = []

def check(name, ok):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok: failures.append(name)

def seed(config, pid, sid, text):
    """A session record for `pid` and its log, under a Claude config folder."""
    (config / "sessions").mkdir(parents=True, exist_ok=True)
    project = config / "projects" / "-work"
    project.mkdir(parents=True, exist_ok=True)
    (project / (sid + ".jsonl")).write_text(json.dumps({"type": "user", "uuid": "u1", "message": {"role": "user", "content": text}}) + "\n", encoding="utf-8")
    (config / "sessions" / (str(pid) + ".json")).write_text(json.dumps({"pid": pid, "sessionId": sid, "cwd": "/work"}), encoding="utf-8")

def found(r):
    """The log path a reader run reported, or ''."""
    return next((unquote(l[5:]) for l in r.stdout.splitlines() if l.startswith("PATH|")), "")

with tempfile.TemporaryDirectory() as home:
    alt = Path(home) / "profiles" / "work"
    sleeper = [sys.executable, "-c", "import time; time.sleep(60)"]
    plain_env = {k: v for k, v in os.environ.items() if k != "CLAUDE_CONFIG_DIR"}
    plain_env.update(HOME=home, USERPROFILE=home)
    profiled = subprocess.Popen(sleeper, env=dict(plain_env, CLAUDE_CONFIG_DIR=str(alt)))
    plain = subprocess.Popen(sleeper, env=plain_env)
    stranger = subprocess.Popen(sleeper, env=plain_env)
    script = str(bundle())
    try:
        seed(alt, profiled.pid, "aaaaaaaa-0000-0000-0000-000000000001", "from the profile")
        seed(Path(home) / ".claude", plain.pid, "bbbbbbbb-0000-0000-0000-000000000002", "from the default")
        def read(pid, env=plain_env, hint=""):
            return subprocess.run([sys.executable, script, "--app", "claude-code", "--pid", str(pid), "--hint", hint], env=env, capture_output=True, text=True, encoding="utf-8")
        if os.path.isdir("/proc") or sys.platform == "darwin":
            r = read(profiled.pid)
            check("the reader runs", r.returncode == 0)
            check("a session under the process's CLAUDE_CONFIG_DIR is found", str(alt) in found(r))
            r = read(profiled.pid, hint=str(profiled.pid))
            check("a hinted session under the process's CLAUDE_CONFIG_DIR is found", str(alt) in found(r))
        r = read(plain.pid)
        check("a session under ~/.claude is still found", os.path.join(home, ".claude") in found(r))
        r = read(profiled.pid, env=dict(plain_env, CLAUDE_CONFIG_DIR=str(alt)))
        check("a session under the reader's own CLAUDE_CONFIG_DIR is found", str(alt) in found(r))
        r = read(stranger.pid)
        check("another terminal's sessions aren't taken", found(r) == "")
    finally:
        os.unlink(script)
        for p in (profiled, plain, stranger):
            p.kill()
            p.wait()

sys.exit(1 if failures else 0)
