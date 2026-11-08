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
    clicking it lists each step: a thought in full markdown, or a command or file name with its
    output wrapped in a box. A thought past about four lines, or output past six, shows a preview,
    and clicking that step shows the rest;
  - 28 px of extra space where you and the agent take turns;
  - at the bottom, while the agent works, an accent-coloured spark and its live status message;
  - messages fade out over the last 20 px above the reply area as they scroll under it, and the
    newest message has 32 px of room below it;
  - a rounded reply box that grows from one to four lines as you type, with a round send button in
    the theme's accent, and a line under it saying which terminal it sends to; attached images sit
    above the text as 64 px thumbnails, each with a remove button;
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
- **↑ and ↓ in the reply box.** The line above or below at the same column (a run of them keeps the
  column it started from), the start on the first line, the end on the last. Lines are those between
  line breaks: a long line that wraps counts as one. Shift+↑/↓ keep the textarea's own selection.
- **Sending.** Enter sends, Shift+Enter is a new line; Enter never leaves a new line in the box
  (the textarea's own one is taken out again). The box empties at once, and a send that fails puts
  the text and images back. The text is typed into the agent's live
  terminal with `hc send`, from the agent's own machine and without hc's terminal identity, so it
  arrives as plain typing rather than wrapped in `<hc from="…">`. Sending to a terminal that is
  waiting on a question needs `--force`; the chat only does that after checking the question on
  screen hasn't changed since it was shown.
- **Images.** Drop image files (png, jpg, gif, webp) anywhere on the chat, or press Ctrl+V with an
  image on the clipboard (wl-paste, xclip or pngpaste; PowerShell on Windows). Each is shrunk to a
  JPEG under 240 KB when it's bigger (Claude Code drops an @-mentioned image over about 256 KB),
  kept as a preview copy in `~/.config/herdr-app/cache/herdr-chat/` until it's sent or removed
  (`image()` draws only from the herdr home), and sent with `hc put` beside the agent's terminal,
  here or on another machine, in a folder herdr-core removes with the terminal. The message carries
  it the way each agent attaches an image itself: Claude Code an `@path` mention; Codex the path
  pasted alone first (it makes `[Image #N]` of that), then the text; Pi and OpenCode the plain path
  (their models open it with `read`).
- **Images in the conversation.** One rule for every harness: a message's images are the paths in
  its text under herdr's `herdr-core/*/files/` folder, however the harness wrote them (`path`,
  `@path`, `@"path"`, Codex's `<image path="…">`). `placed_images()` in `readers/common.py` takes
  them out of the text and the bubble shows them above it. The agent's copy stays in herdr's folder,
  which herdr-core removes with the terminal: the chat's ways of sending read it without a permission
  prompt in Claude Code's default mode and in a read-only Codex. `image()` draws only from the herdr
  home (absolute paths, `..` and symlinks stay blank), so a thumbnail is a display copy in
  `cache/herdr-chat/sent/<machine>~<terminal>~<file name>`: the chat moves a sent preview there, and
  fetches any other placed image from the agent's machine the first time it shows, shrunk when big.
  Thumbnails go with their terminal (checked at start and hourly; a machine that isn't connected
  keeps its own). A chip with the file name stands in when the file is gone.
  Images attached inside a harness's own terminal aren't translated: they show as it wrote them.
- **Skills.** Typing what the agent's own terminal takes (`/`, plus `$` on Codex and `@` on OpenCode) opens a menu of its skills above the reply box: ↑↓ to choose, Enter or Tab to insert, Esc to close. It filters as you type, in memory: the reader lists the skills on the agent's machine in the background when you switch to a session, from the harness's skill folders plus the list in its session log where it writes one (Claude Code's built-in and plugin skills are only there, so they appear after the first message). What it inserts is the harness's own form: `/name`, `$name`, `/skill:name`, `@name`. Each adapter holds those as data. Anything else, like `/compact` or a path, is just text. Codex and OpenCode take a first Enter into their own popup when a skill ends the message, so the chat presses it twice for them.
- **Questions with previews.** Claude Code draws an option's `preview` in a box beside the options, cut to the terminal's height, and only writes the question to its log once it's answered. The card lays the box out next to the options. In Chat, where the terminal isn't in view, it reads a cut preview by attaching at the height it needs for a moment (`input-box.py tall`), once per option, and remembers it. In Terminal view it never resizes anything, and on Windows the card says how many lines are hidden. ↑↓ move between options, since clicking one answers it. Notes (`n`) are terminal-only.
- **One draft.** The chat box and the agent's own input box hold the same draft. Switching a
  session to Terminal types the chat's draft, images included, into the agent's box without
  sending it (an empty draft empties the box); switching back reads the box into the chat, turning
  the chat's own image entries back into thumbnails and a long paste's placeholder (`[Pasted text
  #1 +7 lines]`) back into its text. An image pasted in the terminal itself stays there with a note:
  the agent keeps it where the chat can't read it. A chat send empties the agent's box first.
  Switching to Chat puts the keyboard in the reply box.
- **Diagrams.** A reply's ```` ```mermaid ```` block shows as a picture right in the reply, drawn by
  [Pele](https://github.com/obsidianmd/pele) in the theme's colors and scaled to the column, with no
  frame around it. While it draws, a "Drawing diagram…" line stands in; when Pele can't parse it, its
  source shows as a code block with the reason. Ten types are included: flowchart, sequence, state,
  class, ER, Gantt, pie, mindmap, timeline and git graph.
- **Questions.** When an agent is blocked the chat shows "<Agent> needs your input" with the last
  twelve lines of its screen and ↑ ↓ Enter Esc buttons (sent as keys through `hc keys`) and an Open
  terminal button. Each key is only sent if the screen still shows the same question.
- **Reading.** The agent's session file is found once per session and remembered (shared key
  `herdr-chat.paths`). The first read takes the last 24 MB of the file (at most the last 400
  entries); later reads return only the lines added since. On this computer a change to the file
  wakes the chat (`watchFolder`). Every agent is also read when herdr reports a change in it
  (status, activity, turn), at once and 1 and 4 s later; for an agent on another machine that is
  how the chat updates. While the agent on screen works and herdr reports nothing new about it
  for 1.5 s, its screen is read every 1.5 s for a question (Pi asks while working) and, on another
  machine, its conversation too: some agents report nothing mid-turn.
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
| `main.js` | the chat View: creates the components, runs the timers, switches sessions, lays out the header, list, card and composer, stops the agent |
| `components/` | the View's parts, each a class owning its state and given the View as `host`; `tests/structure.mjs` holds each one to its listed host API. `chat-list.js`: rows, heights, measuring, following. `question-card.js`: a question read off the screen, shown and answered. `composer.js`: the reply box, drafts and images, mirroring, sending. `session-reader.js`: the shown conversation (`session`) and the ones kept in memory, read and kept fresh |
| `model/` | pure data, no gpui or herdr imports (`tests/structure.mjs` checks): `transcript.js` (folding tool calls and thinking, a step's preview, row keys, a group's summary), `session.js` (a session's state, the reader's output applied to it, the batch run), `prompts.js` (`parseChoices`: a choice prompt read off the screen, the harness's `prompt` options deciding how), `caret.js`, `hash.js` |
| `ui/` | drawing: `primitives.js` (column width, icons, program icon, pane buttons, status badge, view toggle, clock, disclosure, bubble, key button, checkbox) and `rows.js` (each conversation row, drawn from the row and `{ t, open, width }`) |
| `images.js` | where image preview copies go and what they're named, and the sent previews bubbles draw |
| `draft.js` | kept drafts in shared state: `storeDraft` is their one writer |
| `harnesses/` | one adapter per harness (`claude-code.js`, `codex.js`, `pi.js`): its label, how it takes images, whether drafts mirror, its prompt options, its input box's shape and its reader. `index.js` is the registry and the image/draft logic driven by those fields. Nothing outside this folder names a harness (`tests/harnesses.mjs` checks) |
| `terminal.js` | the target agent, reading its screen, sending as the person, keys, `input-box.py` |
| `platform.js` | Windows and Unix differences: paths, quoting, base64, deleting files |
| `diagrams.js` | mermaid diagrams: Pele's SVG with the theme's colors and font lists written in, drawn one per tick |
| `vendor/pele/` | Pele, copied by `scripts/vendor-pele.mjs` from the version `package.json` pins (don't edit) |
| `header.js` | the terminal pane header with the toggle |
| `common.js` | session keys, per-session view memory, `layout.select` |
| `readers/` | the session reader (Python 3.6+), one file per harness (`claude_code.py`, `codex.py`, `pi.py`) beside `common.py` (arguments, output tags, process helpers) and `main.py` (dispatch through `READERS`). The mod joins them in `manifest.json` order into one script for `python3 -c`, here and on other machines; Windows runs the same script with `py -3` or `python` |
| `send.ps1` | sends text on Windows without hc's terminal identity |
| `prepare-image.sh` / `prepare-image.ps1` | copy an image (or the clipboard's) into the preview folder, shrunk under 240 KB |
| `input-box.py` | reads, sets or pastes into an agent's own input box without Enter, through `hc attach` in a pty (the one draft, pasted images); the box is found by the adapter's `box` shape |
| `icons/` | the mod's own SVG icons |

Herdr functions used: `agents()`, `terminals()`, `panes()`, `focused()`, `props()`, `theme()`,
`settings()`, `shared()` / `setShared()`, `hc()`, `exec()`, `appHome()`, `watchFolder()`,
`run("layout.select" | "pane.split" | "pane.zoom" | "pane.close" | "pane.focus")`, and `cx.theme()`
with `set_theme` from `gpui-base`. UI parts: `v_virtual_list` with a `VirtualListScrollHandle`,
`TextareaState` / `Textarea`, `TextView.markdown`, `.loop()` and `.frames()` for animation.

## Watch out

**Before adding it, tell the person what it does** (herdr's rule for shared mods). This mod:

- runs programs: `powershell.exe` (Windows), `python3`, `sh`, `env`, `hc` (also `hc attach`,
  `hc put`), `wl-paste` / `xclip` / `pngpaste` and ImageMagick (`magick`) or `sips`, including on other
  machines through `exec(…, { on: machine })`; the Python reader is joined from `readers/` and passed to `python3 -c`
  (`py -3` or `python` on Windows), so nothing is installed on the other machine, but `python3` and
  `hc` must be there;
- reads the agents' skill folders (`SKILL.md` files, in the person's and the project's folders), and files outside its own folder: the agents' session logs under `~/.claude/projects`,
  `~/.claude/sessions`, `~/.codex/sessions` and `~/.pi/agent/sessions`, and reads the terminal's
  screen with `hc read`;
- types into terminals (`hc send`, `hc keys`, and pastes and Delete/Backspace through `hc attach`);
- writes image copies under `~/.config/herdr-app/cache/herdr-chat/` (unsent ones removed after a day, sent ones kept in `sent/` until their terminal is gone); uninstalling the mod leaves them, so delete that folder too;
- changes one colour in herdr's shared palette for the whole app while it runs: `set_theme` with
  the palette's `accent` (and `selection`) set to a dimmed version of the theme's accent. It's the
  only way to make selected text visible in herdr's built-in text boxes; it follows the theme and
  is re-applied if herdr resets it. It does not touch the theme files.

It does not use the network.

Things a fresh build would get wrong:

- **Diagrams need real colors.** Pele colors its SVG through CSS variables and herdr's SVG renderer
  has no stylesheet: shapes come out black and text is missing. Write the theme's colors into the
  SVG (each `--_x` Pele defines on its root, and series colors used as `var(--pele-series-N,…)`).
- **Nothing clickable inside a list row.** A handler registered in `v_virtual_list`'s item renderer
  throws; the list's `on_item_click` gets a row's key. A diagram is a row of its own (its reply is
  split around it), so it's measured on its own and again once drawn.
- **↑/↓ never reach a handler outside the textarea**, not even at its first or last line, and it can
  neither say where its cursor is nor be asked to move it by action name (`dispatch_action` reaches
  only handlers a script registered). So the chat binds `up`/`down` in context
  `HerdrChatReply > Input` (the textarea's context is `Input`) to its own actions, reads the cursor
  by typing an invisible marker at it with `replace()` and putting the text back (`model/caret.js`), and
  moves it with `set_selected_range`. Bind once per engine: the keymap is the app's.
- **Scrolling a virtual list to the bottom takes a frame or more.** `scroll_to_bottom()` lines up
  the last row's *top* with the view's (so the list ends with a short spacer row, or a long last
  message shows from its start), applies in a later frame, and its first call after a switch can
  fall short. A switch is done in the frame that first sees the new agent (`switchSession`, from
  `render`), scrolls there, and keeps the list hidden until the list reports its spacer on screen
  (`visibleEnd`), scrolling again meanwhile. `render` can't `notify()`, but its `cx.timer` works.
- **Every agent's chat is kept read in the background.** When herdr reports a change in an agent,
  `warm()` (reading.js) reads its machine's agents' logs from where they last stopped, all in one Python run
  (`batchProgram` in model/session.js runs the reader once per session and separates their output), so a
  switch shows the conversation at once. The chat shows once its bottom screenful is measured; older
  rows are measured after. A slow read of a stale conversation shows "Checking for new messages…"
  after 300 ms, and after 5 s (or a failed read) "<machine> isn't answering", with Retry.
- **A Codex terminal's log isn't always the one started with it.** `codex resume <id>` goes on in
  that session's own logs, started days before the terminal, and Codex continues a long session in
  `rollout-<time>-<id>_<part>.jsonl`; the reader takes the id from the command line and opens the
  newest part. "Approve for me" runs a reviewer that writes its own logs in the same folder, marked
  `source: {"subagent": ...}`: never read one, even when the chat remembers it.
- **Messages sent while Claude Code works aren't "user" entries.** Claude logs a steer as an
  `attachment` of type `queued_command` (its text in `prompt`) in the conversation chain, so the
  reader shows those too (human origin, prompt mode). Codex and Pi log a steer as an ordinary user
  message.
- **Pele is copied, not installed.** A mod imports only from its own folder and herdr has no npm,
  so `vendor/pele/` is committed; `npm install && npm run vendor:pele` updates it from the pin and
  `node scripts/vendor-pele.mjs --check` tells whether it matches.

- **Pasting without Enter.** `hc send` always presses Enter and `hc keys` takes only named keys, so
  a paste that waits (an image path for Codex, the mirrored draft) goes through `hc attach` in a
  pty at the terminal's own size, as one bracketed paste, then ctrl+\ to detach. `hc attach` asks
  the terminal for its colours, cell size and device attributes before its first paint: answer them
  or every look waits about a second. Unix only.
- **Reading the input box.** `hc read` is plain text, and an empty box shows a dim placeholder
  (Claude Code's `Try "…"`, Codex's rotating hints). `hc attach --observe`'s first paint keeps the
  styles: rebuild the rows from it and leave dim characters out. Claude Code puts a no-break space
  after its `❯`. Empty the box with Delete and Backspace, never Esc (it interrupts, or opens Claude
  Code's rewind) or up/down (history); `hc keys` waits about 3 s after any typing, so send them in
  the same attach.
- **Ctrl+V belongs to the terminal.** herdr binds it to `terminal.paste_image` while a terminal has
  the keyboard, and the hidden terminal keeps it after switching to Chat unless the reply box is
  focused: the image then lands in the agent's box, not the chat.

- **Escaping.** `\\` in a JavaScript template string is one backslash; the Windows paths to the
  `.ps1` files need it doubled, and a missed one makes `\r` a carriage return and the script never
  starts.
- **`this.header`.** The View already has a `header()` method for the chat's top bar; the flag that
  marks a header copy is `asHeader`. Naming it `header` made every copy draw the header and the
  chat panel blank.
- **Adding a harness.** Write `harnesses/<id>.js` (label, image style, mirroring, prompt options,
  input box shape or `null` without mirroring, skill triggers, form and folders, reader id) and add it to the list in
  `harnesses/index.js`; write `readers/<id>.py` registering `READERS["<id>"] = (find, parse)` and add it
  to `readers/manifest.json` before `main.py`. Its user messages go through `placed_images()`, so images
  need no code of their own. Nothing else should need to change:
  `tests/harnesses.mjs` fails if a harness is named anywhere else or an adapter is incomplete. OpenCode
  went in this way.
- **Rows.** `v_virtual_list` draws each row at the height it is given and clips what doesn't fit.
  Heights are measured by drawing each row once off-screen at the column's width; estimating them
  from text length clipped long replies.
- **Measured sizes are zoomed; layout sizes aren't.** `on_size_change` reports pixels after the
  app's zoom, while `.w()`, `.h()` and `v_virtual_list` sizes take unzoomed px and zoom them again.
  Feeding one straight into the other shrinks every row by the zoom (at 0.9 a long reply loses a
  tenth of its slot and the next message draws over it), and it looks fine at zoom 1. Every
  measured size goes through `measure.js` (`designHeight`, `designPx`, the zoom probe), and
  `tests/measure.mjs` fails if an `on_size_change` handler skips it.
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
- OpenCode is read from its `session_v2` tables only (current versions), and its drafts don't mirror into its own box (its box shape isn't described yet). Other agents (Gemini, …) aren't read.
- Tested on Windows with agents on this computer and on a Linux machine over herdr's machine link,
  when Windows read sessions with PowerShell; the Python reader that replaced it hasn't been run on
  Windows or macOS yet.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/herdr-chat` passes and `herdr-app status` shows no errors
  after switching to the `herdr-chat` layout.
- `npm test` passes: no undefined names (`tests/sweep.mjs`), diagrams drawn with the theme's colors
  and none left as CSS variables (`tests/diagrams.mjs`), `vendor/pele` matching the pinned Pele, and
  the two prompt key patterns alike (`tests/prompt-keys.py`).
- A reply with a ```` ```mermaid ```` block shows the diagram in the chat, in the theme's colors, with
  readable labels.
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
- A screenshot pasted into the reply box shows as a thumbnail; sent to Claude Code, Codex or Pi it
  reaches the agent as an image (Claude Code's and Codex's session logs hold the image itself).
- A draft typed in the chat appears, unsent, in the agent's box after switching to Terminal; edited
  there, it comes back edited after switching to Chat, thumbnails included.
- Changing the theme changes the chat's colours, including the send button and the working spark.
