import json, os, subprocess, sys, tempfile, time, urllib.parse
from pathlib import Path

if not os.path.isdir("/proc"):
    print("SKIP codex-logs: needs /proc"); sys.exit(0)
from reader_bundle import bundle
reader = bundle()
ID = "01a185bc-bc6d-7860-b909-dfd06239af87"

def iso(t): return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t)) + ".000Z"

def rollout(home, name, started, cwd, source, said, mtime):
    # said None: a log with no conversation yet, as Codex starts one at launch.
    path = Path(home, ".codex", "sessions", name)
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [{"type": "session_meta", "payload": {"id": ID, "timestamp": iso(started), "cwd": cwd, "source": source}}]
    if said is None: rows.append({"type": "event_msg", "payload": {"type": "thread_settings_applied"}})
    else: rows.append({"type": "response_item", "payload": {"type": "message", "role": "assistant", "phase": "final", "content": [{"type": "output_text", "text": said}]}})
    path.write_text("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in rows))
    os.utime(path, (mtime, mtime))
    return str(path)

def read(home, work, created, argv, known=None, screen=None, need=None):
    agent = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)", *argv], cwd=work)
    try:
        args = [sys.executable, "-I", str(reader), "--app", "codex", "--pid", str(agent.pid), "--created", str(int(created * 1000)), "--cwd", work]
        if known: args += ["--known", known]
        if screen is not None: args += ["--screen", screen]
        out = subprocess.run(args, capture_output=True, text=True, env={**os.environ, "HOME": home, "CODEX_HOME": ""}).stdout
    finally:
        agent.kill()
    path = next((urllib.parse.unquote(l[5:]) for l in out.splitlines() if l.startswith("PATH|")), "")
    said = [urllib.parse.unquote(l.split("|", 3)[3]) for l in out.splitlines() if l.startswith("M|")]
    if need is not None: need.append("NEED|screen" in out.splitlines())
    return path, said

failed = []
def check(name, got, want):
    if got != want: failed.append(f"{name}: got {got!r}, want {want!r}")

now = time.time()
with tempfile.TemporaryDirectory() as home:
    work = os.path.realpath(tempfile.mkdtemp(dir=home))
    reviewer = {"subagent": {"other": "guardian"}}
    rollout(home, f"2026/10/28/rollout-a-{ID}.jsonl", now - 5 * 86400, work, "cli", "first part", now - 4 * 86400)
    rollout(home, f"2026/11/01/rollout-b-{ID}_01a198ad-b20e-7cd3-99a4-96cde9c48ddd.jsonl", now - 2 * 86400, work, "cli", "latest part", now - 60)
    guardian = rollout(home, "2026/11/03/rollout-c-01a1a320-44f9-7f01-b96d-3c050b08d3b9.jsonl", now - 30, work, reviewer, '{"outcome":"allow"}', now - 10)

    path, said = read(home, work, now - 86400, ["codex", "resume", ID])
    check("resume <id>", said, ["latest part"])
    path, said = read(home, work, now - 86400, ["codex", "resume", ID], known=guardian)
    check("resume <id>, reviewer remembered", said, ["latest part"])
    path, said = read(home, work, now - 60, ["codex"])
    check("new codex, reviewer log only", path, "")
    path, said = read(home, work, now - 86400, ["codex", "resume", "--last"])
    check("resume --last", said, ["latest part"])

with tempfile.TemporaryDirectory() as home:
    # Plain `codex`, then a conversation picked in its /resume: the launch log stays empty, the picked one (from another folder) grows.
    work = os.path.realpath(tempfile.mkdtemp(dir=home))
    started = now - 120
    launch = rollout(home, "2026/11/10/rollout-launch-01a1c8d4-a5dd-7ba0-9b6c-ff5b5a325115.jsonl", started + 2, work, "cli", None, now - 100)
    picked = rollout(home, f"2026/11/01/rollout-picked-{ID}.jsonl", now - 9 * 86400, "/elsewhere/benchmarks", "cli", "the benchmark numbers are ready for you to review", now - 30)
    need = []
    path, said = read(home, work, started, ["codex"], need=need)
    check("resumed inside codex, no screen yet: asks for it", (path, need), (launch, [True]))
    path, said = read(home, work, started, ["codex"], screen="> the benchmark numbers are ready for you to review\n\n  Ask Codex", known=launch)
    check("resumed inside codex: the log the screen shows", (path, said), (picked, ["the benchmark numbers are ready for you to review"]))
    path, said = read(home, work, started, ["codex"], screen="something else entirely on the screen here")
    check("resumed inside codex: a screen showing none of it keeps the launch log", path, launch)
    path, said = read(home, work, started, ["codex"], known=picked)
    check("resumed inside codex, remembered", path, picked)

if failed: sys.exit("FAIL\n  " + "\n  ".join(failed))
print("PASS Codex logs: resumed sessions (also from inside Codex), their parts, and never the approval reviewer's")
