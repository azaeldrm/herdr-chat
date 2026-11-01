"""Step 2 of rebuilding icons/logo-intro.webp and icons/logo-loop.webp (needs Pillow).
Step 1: python tools/logo_frames.py <harness-logo-animated.svg> grid.html, then screenshot it:
  chrome --headless=new --hide-scrollbars --force-device-scale-factor=1
         --default-background-color=00000000 --window-size=3072,2100 --screenshot=grid.png <grid.html as file:// URL>
Step 2: python tools/logo_webp.py grid.png icons
"""
import sys
from PIL import Image
grid_path, out_dir = sys.argv[1], sys.argv[2]
FPS, CELL, COLS, INTRO_N, LOOP_N, SIZE = 30, 192, 16, 45, 90, 112
grid = Image.open(grid_path).convert("RGBA")
frames = []
for i in range(INTRO_N + LOOP_N):
    x, y = (i % COLS) * CELL, (i // COLS) * CELL
    frames.append(grid.crop((x, y, x + CELL, y + CELL)).resize((SIZE, SIZE), Image.LANCZOS))
intro, loop = frames[:INTRO_N], frames[INTRO_N:][::2]
for name, part, ms, count in (("logo-intro.webp", intro, 33, 1), ("logo-loop.webp", loop, 67, 0)):
    part[0].save(f"{out_dir}/{name}", save_all=True, append_images=part[1:], duration=ms, loop=count,
                 quality=82, method=6, minimize_size=True)
