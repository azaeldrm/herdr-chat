"""Lays out every frame of harness-logo-animated.svg in one page: each copy's CSS animation is
paused at its own moment (negative delays), so one screenshot captures the whole clip.
"""
import re, sys
src, out = sys.argv[1], sys.argv[2]
svg = open(src, encoding="utf-8").read()
FPS, CELL, COLS = 30, 192, 16
INTRO, LOOP = 1.5, 3.0
times = [i / FPS for i in range(int(INTRO * FPS))] + [INTRO + i / FPS for i in range(int(LOOP * FPS))]
enter = {"l4": 0.00, "l3": 0.12, "l2": 0.24, "l1": 0.36, "l0": 0.48}
float_ = {"l4": 0.70, "l3": 0.90, "l2": 1.10, "l1": 1.30, "l0": 1.50}
cells = []
for t in times:
    s = re.sub(r'width="\d+" height="\d+"', f'width="{CELL}" height="{CELL}"', svg, count=1)
    def frozen(m):
        layer = m.group(1)
        return (f'<use class="layer {layer}" style="animation-delay:{enter[layer]-t:.4f}s,{float_[layer]-t:.4f}s;'
                f'animation-play-state:paused,paused"')
    s = re.sub(r'<use class="layer (l\d)"', frozen, s)
    cells.append(f'<div class="c">{s}</div>')
rows = -(-len(times) // COLS)
open(out, "w", encoding="utf-8").write(
    f'<!doctype html><html><head><style>html,body{{margin:0;background:transparent}}'
    f'.g{{display:grid;grid-template-columns:repeat({COLS},{CELL}px);grid-auto-rows:{CELL}px}}'
    f'.c{{width:{CELL}px;height:{CELL}px}}</style></head><body><div class="g">{"".join(cells)}</div></body></html>')
print(len(times), "frames;", COLS * CELL, "x", rows * CELL)
