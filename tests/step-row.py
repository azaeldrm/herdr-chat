import importlib.util, sys
from pathlib import Path

path = Path(__file__).resolve().parent.parent / "mods" / "herdr-chat" / "input-box.py"
spec = importlib.util.spec_from_file_location("input_box", path)
box = importlib.util.module_from_spec(spec)
spec.loader.exec_module(box)

claude = "\x1b[0m\x1b[38;2;153;153;153m← \x1b[0m\x1b[38;2;0;0;0m\x1b[48;2;177;185;249m ☒ Color  \x1b[0m☒ Toppings  ☒ Size  ✔ Submit  →\r\n"
pi = " ← \x1b[0m \x1b[0m\x1b[38;2;173;156;147m □ Color \x1b[0m \x1b[0m\x1b[48;2;58;32;19m □ Toppings \x1b[0m \x1b[0m\x1b[38;2;115;82;75m ✓ Submit \x1b[0m →\r\n"
submit = "← ☐ Color  ☐ Size  \x1b[48;2;1;2;3m ✔ Submit \x1b[0m →\r\n"
cut = " ← \x1b[0m □ Color \x1b[0m \x1b[48;2;58;32;19m ■ Toppings \x1b[0m\r\n"
none = "← ☐ Color  ☐ Size  ✔ Submit  →\r\n"
under = submit + "\r\n\x1b[48;2;9;9;9m❯ 1. Submit answers\x1b[0m\r\n  2. Cancel\r\n"

failed = False
for name, paint, want in (("Claude", claude, "Color"), ("Pi", pi, "Toppings"), ("the last step", submit, "Submit"), ("an option under the row", under, "Submit"), ("a row cut off by a narrow window", cut, "Toppings"), ("no highlight", none, None), ("no row", "hello\r\n", None)):
    got = box.highlighted(paint)
    print(f"{'ok' if got == want else 'FAIL'}  {name}: {got}")
    failed = failed or got != want
sys.exit(1 if failed else 0)
