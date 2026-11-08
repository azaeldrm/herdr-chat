import json, os, sqlite3, subprocess, sys, tempfile, urllib.parse
from pathlib import Path
from reader_bundle import READERS, bundle

failed = 0

def check(name, got, want):
    global failed
    ok = got == want
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else ": got %r" % (got,)))
    if not ok: failed += 1

def readers(app):
    """The reader's functions, loaded without running its main part, as if started for `app`."""
    order = [f for f in json.loads((READERS / "manifest.json").read_text()) if f != "main.py"]
    g = {"__name__": "reader"}
    argv, sys.argv = sys.argv, ["read_session", "--app", app]
    try: exec("\n".join((READERS / f).read_text() for f in order), g)
    finally: sys.argv = argv
    return g

def said(g):
    """The user messages a parse added, as (text, images) pairs."""
    return [(e["text"], e.get("images", [])) for e in g["entries"] if e["kind"] == "message" and e["role"] == "user"]

def write(lines):
    f = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
    f.write("".join(json.dumps(l, separators=(",", ":")) + "\n" for l in lines)); f.close()
    return f.name

PLACED = "/home/a/.local/state/herdr-core/default/files/t7/mw7ort-green.png"
SPACED = "/home/a b/.local/state/herdr-core/default/files/t7/mw7ort-two words.png"
WIN = r"C:\Users\a\AppData\Local\herdr-core\default\files\t7\mw7ort-blue.png"

placed = readers("pi")["placed_images"]
check("a bare placed path", placed(f"{PLACED} what is this?"), ("what is this?", [PLACED]))
check("an @ mention, and a quoted one with spaces", placed(f'@{PLACED} @"{SPACED}" these two'), ("these two", [PLACED, SPACED]))
check("Codex's image tag and its [Image #1] reference", placed(f'<image name=[Image #1] path="{PLACED}">\n</image>\n[Image #1] what colour?'), ("what colour?", [PLACED]))
check("inside hc's wrapper", placed(f'<hc from="t2j">{PLACED} what is this?</hc>'), ("what is this?", [PLACED]))
check("anywhere in the text", placed(f"compare it with {PLACED} please"), ("compare it with please", [PLACED]))
check("a Windows path", placed(f"{WIN} and this"), ("and this", [WIN]))
check("paths herdr didn't place, and placed files that aren't images, stay text",
      placed("/home/a/logo.png should be blue, see /x/herdr-core/default/files/t7/notes.txt"), ("/home/a/logo.png should be blue, see /x/herdr-core/default/files/t7/notes.txt", []))
check("only images: no text left", placed(PLACED), ("", [PLACED]))

U = {k: "00000000-0000-4000-8000-%012d" % i for i, k in enumerate(["u1", "t1", "a1", "u2", "u3"])}
def entry(kind, u, parent, **rest):
    return {"parentUuid": U[parent] if parent else None, "isSidechain": False, "type": kind, "uuid": U[u], **rest}
log = write([
    entry("user", "u1", None, message={"role": "user", "content": f"@{PLACED} what colour is this?"}),
    entry("attachment", "t1", "u1", attachment={"type": "file", "filename": "/home/a/shots/typed.png", "content": {"type": "image", "file": {"base64": "AAAA", "type": "image/png"}}}),
    entry("assistant", "a1", "t1", message={"role": "assistant", "content": [{"type": "text", "text": "Green."}]}),
    entry("user", "u2", "a1", message={"role": "user", "content": "@/home/a/shots/typed.png and @src/main.rs"}),
    entry("user", "u3", "u2", message={"role": "user", "content": [{"type": "text", "text": "[Image #1] this one"}, {"type": "image", "source": {"type": "base64", "data": "AAAA"}}]}),
])
g = readers("claude-code"); g["parse_claude"](log)
check("Claude Code: the placed image out of the text; what was attached in its own terminal shows as Claude Code wrote it",
      said(g), [("what colour is this?", [PLACED]), ("@/home/a/shots/typed.png and @src/main.rs", []), ("[Image #1] this one", [])])

g = readers("codex")
def codex_user(*parts): return {"type": "response_item", "payload": {"type": "message", "role": "user", "content": list(parts)}}
g["parse_codex"](write([
    codex_user({"type": "input_text", "text": f'<image name=[Image #1] path="{PLACED}">'}, {"type": "input_image", "image_url": "data:image/png;base64,AAAA"},
               {"type": "input_text", "text": "</image>"}, {"type": "input_text", "text": "[Image #1] what colour is this?"}),
    codex_user({"type": "input_text", "text": '<image name=[Image #1] path="/tmp/codex-clipboard-1.png">'}, {"type": "input_image", "image_url": "data:image/png;base64,AAAA"},
               {"type": "input_text", "text": "</image>"}, {"type": "input_text", "text": "[Image #1] pasted in Codex"}),
]))
check("Codex: the placed image out of the text; its own paste shows as Codex shows it, [Image #1]",
      said(g), [("what colour is this?", [PLACED]), ("[Image #1] pasted in Codex", [])])

g = readers("pi")
g["parse_pi"](write([
    {"type": "message", "timestamp": "2026-11-08T10:00:00.000Z", "message": {"role": "user", "content": [{"type": "text", "text": f"{PLACED} what colour is this?"}]}},
    {"type": "message", "timestamp": "2026-11-08T10:01:00.000Z", "message": {"role": "user", "content": [{"type": "text", "text": "/tmp/pi-clipboard-ad4b.png pasted in Pi"}]}},
]))
check("Pi: the placed image out of the text; its own clipboard paste stays as Pi wrote it", said(g), [("what colour is this?", [PLACED]), ("/tmp/pi-clipboard-ad4b.png pasted in Pi", [])])

home = tempfile.mkdtemp()
os.makedirs(os.path.join(home, "opencode"))
db = os.path.join(home, "opencode", "opencode.db")
con = sqlite3.connect(db)
con.execute("create table session_v2 (id text primary key, directory text, parent_id text, time_created integer, time_updated integer)")
con.execute("create table session_message (id text primary key, session_id text, type text, seq integer, data text)")
con.execute("insert into session_v2 values ('s', '/work', null, 1, 2)")
for seq, data in enumerate([{"text": f'<hc from="t2j">{PLACED} what colour is this?</hc>', "files": []}, {"text": "and these", "files": [{"filename": "/work/shot.png"}]}]):
    con.execute("insert into session_message values (?, 's', 'user', ?, ?)", ("m%d" % seq, seq, json.dumps(data)))
con.commit(); con.close()
g = readers("opencode"); g["parse_opencode"](db + "#s")
check("OpenCode: the placed image out of the text; its own attachments aren't translated", said(g), [("what colour is this?", [PLACED]), ("and these", [])])

with tempfile.TemporaryDirectory() as h:
    os.makedirs(os.path.join(h, ".claude", "sessions")); os.makedirs(os.path.join(h, ".claude", "projects", "-work"))
    Path(h, ".claude", "sessions", "4242.json").write_text(json.dumps({"pid": 4242, "sessionId": "s1", "cwd": "/work"}))
    Path(h, ".claude", "projects", "-work", "s1.jsonl").write_text(Path(log).read_text())
    out = subprocess.run([sys.executable, "-I", str(bundle()), "--app", "claude-code", "--pid", "4242", "--cwd", "/work"],
                         capture_output=True, text=True, env={**os.environ, "HOME": h}).stdout
first = next(l for l in out.splitlines() if l.startswith("M|user|"))
check("the output line carries the images as a fifth field", [urllib.parse.unquote(x) for x in first.split("|")[3:]], ["what colour is this?", json.dumps([PLACED])])

g = readers("claude-code")
said_text = g["claude_user_text"]
check("Claude Code's wrapper round a long paste comes off", said_text('\n\n<pasted_content id="cd93">\nA long message.\nTwo lines.\n</pasted_content id="cd93">\n').strip(), "A long message.\nTwo lines.")
check("words typed round a paste stay", said_text('look: <pasted_content id="a1">\npasted\n</pasted_content id="a1"> ok').strip(), "look: pasted ok")
check("someone writing about the tag isn't changed", said_text("what does <pasted_content> mean?"), "what does <pasted_content> mean?")

sys.exit(1 if failed else 0)
