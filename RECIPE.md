# Herdr Chat

Any Claude Code, Codex, Pi or OpenCode terminal, shown as a chat. A Chat / Terminal toggle in the
pane header swaps one for the other in place; the agent keeps running in its terminal either way.
The chat reads the agent's own session log, so it works for agents on other machines herdr reaches.

![Herdr Chat](preview.png)

## Install

Ask your Herdr agent to add this layout, or copy `mods/herdr-chat/` and `layouts/herdr-chat.json`
into `~/.config/herdr-app/` and switch to `herdr-chat` with `ctrl-shift-l`. Your own layout stays
as it was.

Copy the folder rather than linking it: herdr draws the mod's icons blank through a symlink or a
Windows junction.

Needs Python 3 on every machine with agents (`python3`; on Windows `py -3` or `python`).

**To keep your own layout instead**, wrap its `{ "tab": "active" }` block in this stack and give
its pane look the mod as a header. The names are what the mod looks for:

```json
{ "id": "chat-view", "type": "stack", "active": "chat-panel", "children": [
  { "id": "chat-panel", "type": "block", "content": { "mod": "herdr-chat", "props": { "role": "chat" } } },
  { "id": "terminal-panel", "type": "block", "content": { "tab": "active", "pane": {
      "header": { "content": { "mod": "herdr-chat" }, "height": 42, "position": "top", "reveal": "always" } } } }
] }
```

## What you see

The layout is herdr's `main` (Spaces and Agents on the left, tab pills, Files and Changes panels,
status bar) with its work area swapped for the chat and the terminal.

- **Header** (42 px, on both views): the program's icon, name and folder; on hover split right,
  split down, zoom and close; the agent's status (a spinner while working, "Needs you" while
  blocked, a dot when finished unseen); and the **Chat | Terminal** toggle at the far right.
- **Chat** (a centred column, 740 px wide):
  - your messages as bubbles on the right, with their images above them as 120 px thumbnails;
    the agent's replies on the left as markdown, with code blocks;
  - tools and thinking folded into one grey line per run ("Ran 3 commands, read 2 files ›"),
    opening to each step with its output;
  - mermaid blocks drawn as diagrams in the reply;
  - while the agent works, an accent spark and its live status;
  - a question card above the reply box when the agent asks something;
  - a reply box that grows to four lines, with a round send button in the theme's accent (Stop
    while the agent works) and a line saying which terminal it sends to;
  - a jump-to-bottom button when the newest message is off screen.
- **Empty chat:** herdr's logo with "Opening this … conversation…", "Waiting for this …
  conversation to start." or "No messages in this session yet."

Colours come from the active theme; icons are the mod's own SVGs in the theme's text colour.

## How it behaves

- **Which agents:** terminals whose program reports itself as `claude-code`, `codex`, `pi` or
  `opencode`. Other tabs have no toggle and show the terminal.
- **Which view:** a new agent session starts on Chat. Each session keeps the view it was left in,
  also after a restart (the latest 200, shared key `herdr-chat.views`).
- **Sending:** Enter sends, Shift+Enter is a new line, ↑ and ↓ move between lines. The text reaches
  the live terminal as plain typing (`hc send` from the agent's machine, without hc's
  `<hc from="…">` wrapper). A failed send puts the text back.
- **Stop:** while the agent works, the send button stops it (also Esc). A message the agent hands
  back on Stop returns to the reply box.
- **Images:** drop png, jpg, gif or webp files on the chat, or paste one with Ctrl+V. Big ones are
  shrunk under 240 KB, then placed beside the agent's terminal with `hc put` and attached the way
  each agent does it: Claude Code an `@path` mention, Codex a pasted path, Pi and OpenCode the plain
  path. Images in the conversation show as thumbnails, fetched from the agent's machine.
- **Questions:** when an agent asks a question with choices, the card lists them: ↑↓ move, Enter or
  a click answers, multi-select questions tick rows, multi-step ones step through, and Claude Code's
  previews show beside the options. The card folds to one line. A key is sent only while the screen
  still shows the same question. Other prompts show the screen's last lines with key buttons.
- **Skills:** typing `/` (also `$` on Codex, `@` on OpenCode) opens the agent's skills: ↑↓ choose,
  Enter or Tab insert, Esc closes.
- **One draft:** on Linux and macOS the reply box and the agent's own input box share the draft,
  images included, as you switch between Chat and Terminal.
- **Reading:** the session log is found once and remembered. The first read takes its last 24 MB
  (at most 400 entries), later reads only what was added. Agents are read again when herdr reports
  a change in them; a working agent on screen is also re-read every 1.5 s. The 32 most recent
  conversations stay in memory, so switching back is instant.
- **Following:** the chat stays at the bottom while you're there; scrolling up stops it.
- **Highlight:** selected text, in the chat and in herdr's text boxes, uses a dimmed accent.

## Built from

**Layout** `layouts/herdr-chat.json`: `main` with its tab block replaced by the `chat-view` stack
above. A mod can't place a live terminal, so the swap is `layout.select { stack: "chat-view",
child: "chat-panel" | "terminal-panel" }`, and the same mod runs twice: as the chat
(`props.role: "chat"`) and as the terminal's pane header (it gets `{ pane, terminal }`).

**Mod** `mods/herdr-chat/` (`mod.json` is `{"place":"none"}`):

| Path | Role |
|---|---|
| `main.js` | the chat view: sessions, timers, header, list, card and composer, Stop |
| `header.js` | the terminal pane header with the toggle |
| `common.js` | session keys, each session's view, `layout.select` |
| `components/` | `chat-list.js` (rows, measuring, following), `question-card.js`, `composer.js` (reply box, drafts, images, sending), `session-reader.js` (reading and keeping conversations), `skill-menu.js` |
| `model/` | pure data, no gpui or herdr imports: transcript folding, session state, prompt parsing, caret, hash |
| `ui/` | `primitives.js` (icons, buttons, badges, toggle) and `rows.js` (each conversation row) |
| `harnesses/` | one adapter per agent (label, image style, drafts, prompt options, input box, skills, reader); nothing outside this folder names an agent |
| `readers/` | the session reader in Python 3.6+, one file per agent beside `common.py` and `main.py`, joined in `manifest.json` order |
| `terminal.js`, `platform.js` | the target agent and its screen; Windows and Unix differences |
| `images.js`, `prepare-image.sh` / `.ps1` | image previews: where they go, shrinking, the clipboard |
| `input-box.py`, `send.ps1` | the agent's own input box through `hc attach` (Unix); sending on Windows |
| `diagrams.js`, `vendor/pele/` | mermaid through [Pele](https://github.com/obsidianmd/pele), pinned in `package.json` (don't edit `vendor/`) |
| `icons/` | the mod's SVG icons |

## Watch out

**Tell the person what it does before adding it** (herdr's rule for shared mods). This mod:

- runs programs, here and on other machines (`exec(…, { on })`): `python3` (on Windows `py -3` or
  `python`), `hc` (`send`, `keys`, `put`, `attach`, `read`), `sh`, `powershell.exe`, the clipboard
  tools (`wl-paste`, `xclip`, `pngpaste`) and ImageMagick or `sips`. Nothing is installed on other
  machines: the reader is sent with each run;
- reads the agents' session logs (`~/.claude`, `~/.codex/sessions`, `~/.pi/agent/sessions`,
  OpenCode's database), their skill folders, and terminal screens;
- types into terminals;
- writes image copies under `~/.config/herdr-app/cache/herdr-chat/` (left behind on uninstall);
- sets the app's `accent` and `selection` colours to a dimmed accent while it runs, the only way
  to make selected text visible in herdr's text boxes. It doesn't touch theme files;
- doesn't use the network.

What a fresh build gets wrong:

- **The reader goes to Python as one argument,** too long for Windows' 32,767-character command
  line. On Windows the mod loads it from `readers/` for local agents and sends it zlib-compressed
  to other machines; elsewhere it's sent whole.
- **Windows has no `/proc` or `ps`:** the reader walks the terminal's processes through
  `kernel32`. Python there ends lines with `\r\n`, so split batch output on either.
- **herdr's `writeFile` with bytes can write nothing** and still succeed: check what was written.
- **Thumbnails live in the herdr home:** `image()` leaves absolute paths, `..` and symlinks blank,
  so each preview is a copy in `cache/herdr-chat/sent/`.
- **Diagrams need real colours:** herdr's SVG renderer has no stylesheet, so write the theme's
  colours into Pele's SVG instead of its CSS variables.
- **Nothing clickable inside a virtual-list row:** use the list's `on_item_click`.
- **↑/↓ never leave the textarea:** bind them in its `Input` context and read the caret by typing
  an invisible marker (`model/caret.js`).
- **Measured sizes are zoomed, layout sizes aren't:** every measured size goes through
  `measure.js`.
- **`set_theme` restarts every mod copy:** apply it from a timer, only when the colour changed.
- **`hc send` wraps text from a terminal** in `<hc from="…">`: send from the agent's machine
  without `HC_TERMINAL_ID` and `HC_SCOPE`.
- **Writing into the mod's own folder** reloads the mod.
- **Agent logs aren't simple:** Codex resumes in older logs and splits long ones into parts, and
  its reviewer writes its own logs beside them (never read those). Claude Code logs messages sent
  while it works as `queued_command` attachments. A resumed Pi keeps writing to its old file.
- **Adding an agent:** a `harnesses/<id>.js` adapter listed in `harnesses/index.js`, and a
  `readers/<id>.py` registering `READERS["<id>"]` listed in `readers/manifest.json` before
  `main.py`. `tests/harnesses.mjs` checks nothing else names it.

Limits:

- Only the last 24 MB of a session log is shown.
- On Windows the drafts don't mirror into the agent's box, a long preview stays cut off in a
  question card (it says how many lines are hidden), and Codex gets a pasted image as a plain path.
  These need a pty.
- OpenCode is read from its `session_v2` tables, and its drafts don't mirror. Other agents aren't
  read.
- Tested on Windows, with agents on the same computer and on a Linux machine. Not tried with
  herdr itself on Linux or macOS.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/herdr-chat` passes and `herdr-app status` shows no
  errors on the `herdr-chat` layout.
- `npm test` passes on Linux or macOS.
- A new Claude Code, Codex, Pi or OpenCode tab opens on its chat, with the toggle in the header;
  Terminal brings the terminal back, and each session keeps its view after a restart.
- A message sent from the chat reaches the terminal as plain text, and the reply appears as it's
  written.
- An agent on another machine shows its conversation the same way.
- A pasted screenshot shows as a thumbnail and reaches the agent as an image.
- A question with choices shows as a card, and answering it in the chat answers it in the terminal.
- A mermaid block shows as a diagram in the theme's colours.
- Changing the theme changes the chat's colours.
