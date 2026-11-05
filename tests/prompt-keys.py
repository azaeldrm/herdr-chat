import re, sys
from pathlib import Path
mod = Path(__file__).resolve().parent.parent / "mods" / "herdr-chat"
js = re.search(r"const FOOTER = /(.+)/i;", (mod / "prompts.js").read_text(encoding="utf-8")).group(1)
py = re.search(r'PROMPT_KEYS = re\.compile\(r"(.+)", re\.I\)', (mod / "input-box.py").read_text(encoding="utf-8")).group(1)
if js.replace("\\/", "/") != py:
    sys.exit(f"prompt key hints differ:\n  prompts.js:   {js}\n  input-box.py: {py}")
print("prompt key hints match")
