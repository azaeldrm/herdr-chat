"""Read or set what's typed in an agent's own input box, so the chat's draft and the terminal's agree.

  input-box.py read <terminal> <app>          prints {"box": "<text>"} (null: no input box on screen)
  input-box.py set  <terminal> <app> <pastes>  empties the box, then pastes each string of the JSON
                                              list <pastes> in turn, without sending; prints
                                              {"box": "<the box as read back>"}. Codex makes an image
                                              of a paste that is one image path, so images go alone.
  input-box.py paste <terminal> <text>        pastes <text> into the terminal without pressing Enter

herdr-core's `hc read` gives plain text, and an empty box shows a dim placeholder (Claude Code's
`Try "..."`, Codex's rotating hints) that plain text can't tell from typing. `hc attach --observe`
gets the screen as the program drew it, styles included: this rebuilds the rows from that first
paint and leaves out dim characters. Setting clears with Delete and Backspace, as many as the box
holds (wherever the cursor is, with no Esc: that interrupts or opens Claude Code's rewind, and no
up/down: those walk history), then pastes inside bracketed-paste markers through `hc attach`, since
`hc send` always presses Enter. Unix only (it needs a pty).
"""
import fcntl, json, os, pty, re, select, struct, subprocess, sys, termios, time

ENV = {k: v for k, v in os.environ.items() if k not in ("HC_TERMINAL_ID", "HC_SCOPE")}


def size(terminal):
    info = json.loads(subprocess.run(["hc", "get", "--json", terminal], capture_output=True, text=True, env=ENV, check=True).stdout)
    return int(info.get("rows") or 40), int(info.get("cols") or 120)


def attach(terminal, observe, rows, cols):
    pid, fd = pty.fork()
    if pid == 0:
        os.execvpe("hc", ["hc", "attach", *(["--observe"] if observe else []), terminal], ENV)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    return pid, fd


# hc attach asks the terminal about itself (colors, cell size, device attributes) and waits for
# the answers before its first paint; answering at once saves about a second per look.
REPLIES = [
    (b"\x1b]10;?", b"\x1b]10;rgb:ffff/ffff/ffff\x1b\\"),
    (b"\x1b]11;?", b"\x1b]11;rgb:0000/0000/0000\x1b\\"),
    (b"\x1b]12;?", b"\x1b]12;rgb:ffff/ffff/ffff\x1b\\"),
    (b"\x1b[16t", b"\x1b[6;20;10t"),
    (b"\x1b[c", b"\x1b[?62;22c"),
]


def answer(fd, chunk):
    for ask, reply in REPLIES:
        if ask in chunk:
            try:
                os.write(fd, reply)
            except OSError:
                pass


def drain(fd, quiet, limit):
    """What the attach prints until it has been quiet for `quiet` seconds (at most `limit`)."""
    got, start, last = b"", time.time(), None
    while time.time() - start < limit:
        ready, _, _ = select.select([fd], [], [], 0.03)
        if ready:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                break
            if not chunk:
                break
            answer(fd, chunk)
            got, last = got + chunk, time.time()
        elif last is not None and time.time() - last >= quiet:
            break
    return got


def detach(pid, fd):
    try:
        os.write(fd, b"\x1c")  # ctrl+\
    except OSError:
        pass
    drain(fd, 0.1, 1.0)
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass


CSI = re.compile(r"\x1b\[([0-9;?:=!>]*)([ -/]*)([@-~])")
OSC = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")


def render(paint, rows, cols):
    """The screen as rows of (char, dim) cells, from a first paint (cursor moves, SGR, text)."""
    blank = (" ", False)
    grid = [[blank] * cols for _ in range(rows)]
    r = c = 0
    dim = False
    i, n = 0, len(paint)
    while i < n:
        ch = paint[i]
        if ch == "\x1b":
            m = CSI.match(paint, i)
            if m:
                params, _, final = m.groups()
                private = params[:1] in ("?", "=", ">", "!")
                nums = [int(x) if x.isdigit() else 0 for x in params.lstrip("?=>!").split(";")] if params else []
                arg = lambda k, d=1: nums[k] if len(nums) > k and nums[k] else d
                if private:
                    pass
                elif final in "Hf":
                    r, c = arg(0) - 1, arg(1) - 1
                elif final == "G":
                    c = arg(0) - 1
                elif final == "d":
                    r = arg(0) - 1
                elif final == "A":
                    r -= arg(0)
                elif final in "Be":
                    r += arg(0)
                elif final in "Ca":
                    c += arg(0)
                elif final == "D":
                    c -= arg(0)
                elif final == "K":
                    mode = nums[0] if nums else 0
                    span = range(c, cols) if mode == 0 else range(0, c + 1) if mode == 1 else range(cols)
                    if 0 <= r < rows:
                        for x in span:
                            grid[r][x] = blank
                elif final == "J" and nums[:1] in ([2], [3]):
                    grid = [[blank] * cols for _ in range(rows)]
                elif final == "m":
                    codes, k = nums or [0], 0
                    while k < len(codes):
                        x = codes[k]
                        if x == 0 or x == 22:
                            dim = False
                        elif x == 2:
                            dim = True
                        elif x in (38, 48) and k + 1 < len(codes):
                            k += 4 if codes[k + 1] == 2 else 2
                        k += 1
                r, c = max(0, min(rows - 1, r)), max(0, min(cols - 1, c))
                i = m.end()
                continue
            m = OSC.match(paint, i)
            if m:
                i = m.end()
                continue
            i += 3 if i + 1 < n and paint[i + 1] in "()*+-./#%" else 2
            continue
        if ch == "\r":
            c = 0
        elif ch == "\n":
            r = min(rows - 1, r + 1)
        elif ch == "\b":
            c = max(0, c - 1)
        elif ord(ch) >= 32:
            grid[r][c] = (ch, dim)
            c = min(cols - 1, c + 1)
        i += 1
    return grid


def text_of(row):
    # Claude Code draws a no-break space after its ❯
    return "".join(ch for ch, _ in row).replace("\u00a0", " ").rstrip()


def typed_of(row, skip):
    """A row's typed characters after its first `skip` cells: dim ones (placeholders, suggestions) left out."""
    return "".join(ch for ch, d in row[skip:] if not d).replace("\u00a0", " ").rstrip()


def is_rule(row):
    t = text_of(row).strip()
    return len(t) >= 10 and set(t) <= set("─━═-")


def join(lines):
    """Box rows back into text: a row filled to the box's width ran on into the next one."""
    out = ""
    for k, (line, full) in enumerate(lines):
        out += line
        if k < len(lines) - 1 and not full:
            out += "\n"
    return out


# A choice prompt's key line (a question, a permission request, an approval): the same hints as
# FOOTER in prompts.js, keep the two alike (tests/prompt-keys.py). While one is up the
# agent's input box isn't on screen: Pi's question even sits between the same rules as its editor.
PROMPT_KEYS = re.compile(r"enter to (select|confirm)|↑/↓|to navigate|esc to cancel", re.I)


def box(grid, app):
    rows, cols = len(grid), len(grid[0]) if grid else 0
    texts = [text_of(row) for row in grid]
    if any(PROMPT_KEYS.search(line) for line in [x for x in texts if x.strip()][-6:]):
        return None
    if app in ("claude-code", "codex"):
        mark = "❯" if app == "claude-code" else "›"
        start = next((y for y in range(rows - 1, -1, -1) if texts[y].startswith(mark + " ") or texts[y] == mark), None)
        if start is None:
            return None
        lines = []
        for y in range(start, rows):
            if y > start and (not texts[y].startswith("  ") or is_rule(grid[y])):
                break
            if y > start and app == "codex" and not texts[y].strip():
                break
            line = typed_of(grid[y], 2)
            lines.append((line, len(texts[y]) >= cols - 1))
        while lines and not lines[-1][0]:
            lines.pop()
        return join(lines)
    if app == "pi":
        rules = [y for y in range(rows) if is_rule(grid[y])]
        if len(rules) < 2:
            return None
        top, bottom = rules[-2], rules[-1]
        lines = [(typed_of(grid[y], 0), len(texts[y]) >= cols - 1) for y in range(top + 1, bottom)]
        while lines and not lines[-1][0]:
            lines.pop()
        while lines and not lines[0][0]:
            lines.pop(0)
        return join(lines)
    return None


def read(terminal, app):
    rows, cols = size(terminal)
    pid, fd = attach(terminal, True, rows, cols)
    paint = drain(fd, 0.15, 2.5).decode("utf-8", "replace")
    detach(pid, fd)
    return box(render(paint, rows, cols), app) if paint else None


def type_into(terminal, erase, pastes):
    """One attach: `erase` Deletes and Backspaces (empties the box wherever the cursor is), then each paste."""
    rows, cols = size(terminal)
    pid, fd = attach(terminal, False, rows, cols)
    if not drain(fd, 0.15, 2.5):
        detach(pid, fd)
        sys.exit("hc attach printed nothing")
    if erase:
        # in chunks, so the program reads them as keys and not as one burst it might take for a paste
        for _ in range(0, erase, 20):
            os.write(fd, b"\x1b[3~" * 20 + b"\x7f" * 20)
            drain(fd, 0.02, 0.1)
    for text in pastes:
        if text:
            os.write(fd, b"\x1b[200~" + text.encode() + b"\x1b[201~")
            drain(fd, 0.15, 0.6)
    drain(fd, 0.1, 0.4)
    detach(pid, fd)


def paste(terminal, text):
    type_into(terminal, 0, [text])


def main():
    cmd = sys.argv[1]
    if cmd == "read":
        print(json.dumps({"box": read(sys.argv[2], sys.argv[3])}))
    elif cmd == "paste":
        paste(sys.argv[2], sys.argv[3])
    elif cmd == "set":
        terminal, app, pastes = sys.argv[2], sys.argv[3], [p for p in json.loads(sys.argv[4]) if p]
        now = read(terminal, app)
        if now is None:
            sys.exit("no input box on screen")
        if now or pastes:
            type_into(terminal, len(now) + now.count("\n") + 8 if now else 0, pastes)
            time.sleep(0.15)
            now = read(terminal, app)
        print(json.dumps({"box": now}))


if __name__ == "__main__":
    main()
