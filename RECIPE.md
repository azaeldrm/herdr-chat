# Herdr Chat

Any Claude Code, Codex or Pi terminal, shown as a chat. A Chat / Terminal toggle in the top-right
of the pane header swaps one for the other in place; the agent keeps running in its terminal either
way. The chat reads the agent's own session log, so it also works for agents on other machines
herdr reaches.

![Herdr Chat](preview.png)

## Install

This repository is laid out like the herdr home (`~/.config/herdr-app`):

1. Copy `mods/herdr-chat/` to `~/.config/herdr-app/mods/herdr-chat/`.
2. Copy `layouts/herdr-chat.json` to `~/.config/herdr-app/layouts/herdr-chat.json`.
3. Switch to it: `herdr-app do layout.switch --name herdr-chat` (or `ctrl-shift-l`). Your own layout
   stays as it was; switch back the same way.

Without the layout the chat panel still loads but has nothing to swap with and no toggle: the
in-place swap lives in the layout (see Built from).

## What you see

The layout is herdr's shipped `main` layout (Spaces and Agents on the left, tab pills, Files and
Changes panels, status bar) with one change: the work area is a `chat-view` stack of two children,
the chat and the live terminal.

- **Terminal view.** The terminal pane has a 42 px header: the program's icon, its name, its
  folder, then on hover split right, split down, zoom and close, then the agent's status (a
  spinner while working, a "Needs you" badge while blocked, a dot when finished unseen), and at the
  far right the **Chat | Terminal** toggle with Terminal selected. Every session starts here.
- **Chat view.** The same 42 px header, then a centred column 740 px wide:
  - your messages as rounded bubbles on the right; the agent's replies as plain text on the left,
    rendered as markdown with fenced code blocks;
  - tools and thinking folded into one grey line per run, like "Ran 3 commands, read 2 files ›";
    clicking it lists each step with its command or file name and up to six lines of output;
  - 28 px of extra space where you and the agent take turns;
  - at the bottom, while the agent works, an accent-coloured spark and its live status message;
  - messages fade out over the last 20 px above the reply area as they scroll under it, and the
    newest message has 32 px of room below it;
  - a rounded reply box that grows from one to four lines as you type, with a round send button in
    the theme's accent, and a line under it saying which terminal it sends to;
  - a round "jump to bottom" button when the newest message is off screen.
- **Empty chat.** Herdr's own logo (`frame/welcome/herdr.png`) with a message: "Opening this Pi
  conversation…" (the logo pulses), "Waiting for this … conversation to start.", or "No messages in
  this session yet." (it holds still).

All colours come from the active theme (`theme()`), so the chat matches whichever theme or layout it
runs in. Icons are the mod's own SVGs drawn in the theme's text colour.

## How it behaves

- **Which agents.** Terminals whose program reports itself as `claude-code`, `codex` or `pi`. Other
  tabs have no toggle and always show the terminal.
- **Which view.** Every session starts in the terminal. Clicking Chat switches that session, and it
  stays in the chat, also after a restart, until switched back. A session is the agent's terminal
  address plus its start time; the latest 200 are remembered (shared key `herdr-chat.views`).
  Moving to another tab or agent shows that session's remembered view.
- **Sending.** Enter sends, Shift+Enter is a new line. The text is typed into the agent's live
  terminal with `hc send`, from the agent's own machine and without hc's terminal identity, so it
  arrives as plain typing rather than wrapped in `<hc from="…">`. Sending to a terminal that is
  waiting on a question needs `--force`; the chat only does that after checking the question on
  screen hasn't changed since it was shown.
- **Questions.** When an agent is blocked the chat shows "<Agent> needs your input" with the last
  twelve lines of its screen and ↑ ↓ Enter Esc buttons (sent as keys through `hc keys`) and an Open
  terminal button. Each key is only sent if the screen still shows the same question.
- **Reading.** The agent's session file is found once per session and remembered (shared key
  `herdr-chat.paths`). The first read takes the last 24 MB of the file (at most the last 400
  entries); later reads return only the lines added since. On this computer a change to the file
  wakes the chat (`watchFolder`), with a re-read every 15 s as a safety net; for an agent on another
  machine it polls every 1.5 s.
- **Switching.** Picked up within 100 ms. The twelve most recent conversations stay in memory, so
  switching back is instant and reads only what's new.
- **Following.** The chat stays at the bottom while you're at the bottom; scrolling up stops it and
  shows the jump button. Opening the chat, sending, or the jump button goes back to the bottom.
- **Highlight.** Selected text in the chat and in herdr's built-in text boxes is drawn in a dimmed
  version of the theme's accent instead of the near-invisible gray herdr derives from the hover
  colour (see Watch out).

## Built from

Layout (`layouts/herdr-chat.json`): `main.json` with its `main` block replaced by

```
chat-view   stack, active "terminal-panel"
  chat-panel      block  { mod: "herdr-chat", props: { role: "chat" } }
  terminal-panel  block  { tab: "active", pane: { ...main's pane look,
                           header: { content: { mod: "herdr-chat" }, height: 42,
                                     position: "top", reveal: "always" } } }
```

A mod can't place a live terminal, so the swap is the layout's `layout.select { stack: "chat-view",
child: … }`. The same mod is therefore used twice: as the chat panel and as the terminal pane's
header; `props()` tells the two copies apart (a header copy gets `{ pane, terminal }`).

Mod (`mods/herdr-chat/`, `mod.json` is `{"place":"none"}`):

| File | Role |
|---|---|
| `main.js` | the chat view; picks the target agent, keeps conversations, draws everything |
| `header.js` | the terminal pane header with the toggle |
| `common.js` | the supported agents, per-session view memory, `layout.select` |
| `read-session.ps1` | session reader on Windows (PowerShell 5.1) |
| `read_session.py` | the same reader for Linux, macOS and other machines (Python 3.6+) |
| `send.ps1` | sends text on Windows without hc's terminal identity |
| `icons/` | the mod's own SVG icons |

Herdr functions used: `agents()`, `terminals()`, `panes()`, `focused()`, `props()`, `theme()`,
`settings()`, `shared()` / `setShared()`, `hc()`, `exec()`, `appHome()`, `watchFolder()`,
`run("layout.select" | "pane.split" | "pane.zoom" | "pane.close" | "pane.focus")`, and `cx.theme()`
with `set_theme` from `gpui-base`. UI parts: `v_virtual_list` with a `VirtualListScrollHandle`,
`TextareaState` / `Textarea`, `TextView.markdown`, `.loop()` and `.frames()` for animation.

## Watch out

**Before adding it, tell the person what it does** (herdr's rule for shared mods). This mod:

- runs programs: `powershell.exe` (Windows), `python3`, `sh`, `env` and `hc`, including on other
  machines through `exec(…, { on: machine })`; the Python reader is passed to `python3 -c`, so
  nothing is installed on the other machine, but `python3` and `hc` must be there;
- reads files outside its own folder: the agents' session logs under `~/.claude/projects`,
  `~/.claude/sessions`, `~/.codex/sessions` and `~/.pi/agent/sessions`, and reads the terminal's
  screen with `hc read`;
- types into terminals (`hc send`, `hc keys`);
- changes one colour in herdr's shared palette for the whole app while it runs: `set_theme` with
  the palette's `accent` (and `selection`) set to a dimmed version of the theme's accent. It's the
  only way to make selected text visible in herdr's built-in text boxes; it follows the theme and
  is re-applied if herdr resets it. It does not touch the theme files.

It does not use the network.

Things a fresh build would get wrong:

- **Escaping.** `\\` in a JavaScript template string is one backslash; the Windows paths to the
  `.ps1` files need it doubled, and a missed one makes `\r` a carriage return and the reader never
  starts.
- **`this.header`.** The View already has a `header()` method for the chat's top bar; the flag that
  marks a header copy is `asHeader`. Naming it `header` made every copy draw the header and the
  chat panel blank.
- **Rows.** `v_virtual_list` draws each row at the height it is given and clips what doesn't fit.
  Heights are measured by drawing each row once off-screen at the column's width; estimating them
  from text length clipped long replies.
- **`set_theme` restarts every mod copy.** Calling it at start-up, or on every tick when a colour
  comparison never matches (herdr returns colours without their alpha), restarts the mod in a loop.
  It is applied from a timer, and only when the RGB part differs.
- **Writing files into the mod's own folder** (debug dumps, say) makes herdr reload the mod.
- **`hc` tags messages.** Text sent while the sender looks like a terminal, or another machine, is
  wrapped in `<hc from="…">`; send from the agent's machine without `HC_TERMINAL_ID` and `HC_SCOPE`.
- **Windows arguments.** PowerShell 5.1 drops embedded double quotes when starting programs, so
  `send.ps1` starts `hc` through `ProcessStartInfo` with an explicitly quoted command line.
- **Pi sessions.** A resumed Pi session keeps appending to its original file, so the file can be
  weeks older than the terminal; only entries since the terminal started are shown. Two Pis in one
  folder are told apart by which file's latest messages show on the terminal's screen.

Limits and gaps:

- A session file is read from its last 24 MB on first open; older history isn't shown.
- Questions appear as terminal text with key buttons, not as parsed options.
- Messages sent while an agent is busy are typed straight in, not queued; there is no stop button.
- Other agents (OpenCode, Gemini, …) aren't read.
- Reading another machine's agent costs one remote command about every 1.5 s while it's on screen.
- Tested on Windows with agents on this computer and on a Linux machine over herdr's machine link;
  the Python reader has not been run on macOS.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/herdr-chat` passes and `herdr-app status` shows no errors
  after switching to the `herdr-chat` layout.
- On a Claude Code, Codex or Pi tab the pane header shows the Chat | Terminal toggle at the far
  right, also while the hover buttons are showing, and the terminal is selected.
- Clicking Chat shows that agent's conversation within a second or two, scrolled to the newest
  message, and clicking Terminal brings the terminal back; moving to another tab and back shows each
  in the view it was left in, also after restarting herdr.
- A message typed in the chat and sent with Enter appears in the agent's terminal as plain text, with
  no `<hc from=…>` around it, and the agent's reply appears in the chat as it is written.
- A reply with a long code block is shown in full, without being cut off.
- With an agent waiting on a question, the chat shows the question's last lines with the key buttons,
  and ↓ then Enter in the chat answers it in the terminal.
- An agent on another machine (`machine/tN`) shows its conversation the same way.
- Selecting text in the chat and in the reply box shows a visible highlight.
- Changing the theme changes the chat's colours, including the send button and the working spark.
