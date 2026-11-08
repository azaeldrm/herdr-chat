import json, os, subprocess, sys, tempfile, urllib.parse
from pathlib import Path
from reader_bundle import READERS, bundle

failed = 0

def check(name, got, want):
    global failed
    ok = got == want
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else ": got %r" % (got,)))
    if not ok: failed += 1

reader = str(bundle())

def skill(root, folder, body):
    d = Path(root, folder)
    d.mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_text(body)

def run(home, app, cwd, spec, known=""):
    """The skills the reader lists, as (name, description, source)."""
    args = [sys.executable, "-I", reader, "--app", app, "--cwd", cwd, "--skills", json.dumps(spec)]
    if known: args += ["--known", known]
    out = subprocess.run(args, capture_output=True, text=True, env={**os.environ, "HOME": home}).stdout
    return [tuple(urllib.parse.unquote(x) for x in l.split("|")[1:]) for l in out.splitlines() if l.startswith("S|")]

home = tempfile.mkdtemp()
work = os.path.join(home, "code", "repo", "sub")
os.makedirs(work)
user = os.path.join(home, ".h", "skills")
skill(user, "plain", "---\nname: plain\ndescription: A plain one\n---\nbody\n")
skill(user, "folded", "---\nname: folded\ndescription: >\n  Wraps over\n  two lines.\nother: x\n---\n")
skill(user, "quoted", '---\nname: quoted\ndescription: "Has: a colon"\n---\n')
skill(user, "folder-name", "---\ndescription: No name field\n---\n")
skill(user, "no-front", "just text\n")
skill(user, "hidden-from-people", "---\nname: hidden-from-people\nuser-invocable: false\n---\n")
skill(user, "nested/deeper/inner", "---\nname: inner\ndescription: Deeper\n---\n")
skill(user, "plain/references/not-a-skill", "---\nname: not-a-skill\n---\n")
skill(user, ".hidden/x", "---\nname: in-hidden\n---\n")
skill(user, ".system/sys", "---\nname: sys\n---\n")
skill(user, "synced/abc/pdf", "---\nname: pdf\n---\n")
target = os.path.join(home, "elsewhere", "linked")
skill(os.path.dirname(target), "linked", "---\nname: linked\ndescription: Through a symlink\n---\n")
os.symlink(target, os.path.join(user, "linked"))
skill(os.path.join(home, "code", "repo", ".h", "skills"), "plain", "---\nname: plain\ndescription: The project's own\n---\n")
skill(os.path.join(work, ".h", "skills"), "here", "---\nname: here\ndescription: In this folder\n---\n")

spec = {"user": ["~/.h/skills"], "project": [".h/skills"], "skip": ["synced"]}
found = {n: (d, s) for n, d, s in run(home, "pi", work, spec)}
check("a description is read", found["here"], ("In this folder", "project"))
check("the person's own folder says so", found["folded"][1], "personal")
check("a project's skill wins over the person's, from a folder above too", found["plain"], ("The project's own", "project"))
check("a folded description becomes one line", found["folded"][0], "Wraps over two lines.")
check("quotes are taken off, a colon kept", found["quoted"][0], "Has: a colon")
check("no name field: the folder's name", "folder-name" in found, True)
check("no frontmatter still lists", "no-front" in found, True)
check("nested skills are found", "inner" in found, True)
check("links are followed", found["linked"][0], "Through a symlink")
check("skills people can't invoke stay out", "hidden-from-people" in found, False)
check("a skill's own subfolders aren't searched", "not-a-skill" in found, False)
check("hidden folders are skipped", "in-hidden" in found, False)
check("except .system, where Codex keeps its own", "sys" in found, True)
check("folders the harness says to skip are skipped", "pdf" in found, False)
check("a project above the home folder isn't searched", run(home, "pi", os.path.dirname(home), {"user": [], "project": [".nope"], "skip": []}), [])
skill(os.path.join(home, ".h", "skills"), "home-level", "---\nname: home-level\n---\n")
check("the home folder's skills are the person's, not a project's, wherever the terminal runs", dict((n, s) for n, _, s in run(home, "pi", home, spec))["home-level"], "personal")
check("missing folders are fine", run(home, "pi", work, {"user": ["~/.none"], "project": [".none"], "skip": []}), [])

claude = os.path.join(home, "claude.jsonl")
Path(claude).write_text(json.dumps({"parentUuid": None, "type": "attachment", "attachment": {"type": "skill_listing", "names": ["here", "update-config", "anthropic-skills:pdf"],
    "content": "- here: From the log\n- update-config: Change settings: hooks\n- anthropic-skills:pdf: PDF things\n"}}) + "\n" + json.dumps({"type": "user", "message": {"content": "mentions skill_listing only in text"}}) + "\n")
listed = {n: (d, s) for n, d, s in run(home, "claude-code", work, spec, claude)}
check("Claude Code's log adds built-in skills, a colon in the description kept", listed["update-config"][0], "Change settings: hooks")
check("and namespaced ones", listed["anthropic-skills:pdf"][0], "PDF things")
check("its description wins, the folder still says project", listed["here"], ("From the log", "project"))
check("what only the log lists came with the harness", (listed["update-config"][1], listed["anthropic-skills:pdf"][1]), ("built-in", "built-in"))
check("the person's folder skills keep that source in a session too", listed["inner"][1], "personal")
check("folders add what the log doesn't list", "inner" in listed, True)
check("a log that doesn't exist yet is fine", "inner" in {n for n, _, _ in run(home, "claude-code", work, spec, os.path.join(home, "none.jsonl"))}, True)

codex = os.path.join(home, "codex.jsonl")
text = "<skills_instructions>\n## Skills\n### Available skills\n- imagegen: Make images (file: r1/imagegen/SKILL.md)\n- old: Old list\n</skills_instructions>"
newer = "<skills_instructions>\n- imagegen: Make images: now (file: r1/imagegen/SKILL.md)\n</skills_instructions>\n- not-a-skill: outside the block"
Path(codex).write_text("".join(json.dumps({"type": "response_item", "payload": {"type": "message", "role": r, "content": [{"type": "input_text", "text": t}]}}) + "\n"
    for r, t in [("developer", text), ("user", "<skills_instructions>\n- fake: From a user\n</skills_instructions>"), ("developer", newer)]))
listed = {n: d for n, d, _ in run(home, "codex", work, {"user": [], "project": [], "skip": []}, codex)}
check("Codex's newest list, the file path left out", listed, {"imagegen": "Make images: now"})
check("other harnesses' sessions need no log", {n for n, _, _ in run(home, "opencode", work, spec, os.path.join(home, "x.db#id"))} >= {"here"}, True)

def readers(app):
    """The reader's functions, loaded without running its main part, as if started for `app`."""
    order = [f for f in json.loads((READERS / "manifest.json").read_text()) if f != "main.py"]
    g = {"__name__": "reader"}
    argv, sys.argv = sys.argv, ["read_session", "--app", app]
    try: exec("\n".join((READERS / f).read_text() for f in order), g)
    finally: sys.argv = argv
    return g

def said(g): return [e["text"] for e in g["entries"] if e["kind"] == "message" and e["role"] == "user"]
def log(lines):
    f = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
    f.write("".join(json.dumps(l, separators=(",", ":")) + "\n" for l in lines)); f.close()
    return f.name

g = readers("codex")
g["parse_codex"](log([{"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": t}]}}
    for t in ["$imagegen draw a cat", "<skill>\n<name>imagegen</name>\n<path>/x/SKILL.md</path>\nthe whole skill\n</skill>"]]))
check("Codex: the message shows, the skill it loaded doesn't", said(g), ["$imagegen draw a cat"])
g = readers("pi")
msg = lambda t: {"type": "message", "timestamp": "2026-11-08T10:00:00.000Z", "message": {"role": "user", "content": [{"type": "text", "text": t}]}}
g["parse_pi"](log([msg('<skill name="omarchy" location="/x/SKILL.md">\nthe whole\nskill\n</skill>\n\nfix my bar'), msg('<skill name="pdf" location="/y">z</skill>'), msg("plain <skill> talk")]))
check("Pi: a skill shows as it was typed, with what follows", said(g), ["/skill:omarchy fix my bar", "/skill:pdf", "plain <skill> talk"])

sys.exit(1 if failed else 0)
