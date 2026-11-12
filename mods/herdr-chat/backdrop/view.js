// The backdrop: a nested view playing a scene (sharks hunting fish, jellyfish, a night sky, rain) drawn as text
// behind a page. props: {dim, sceneKey}: the shared value naming the scene (an id from scenes/index.js). The view
// reads it every tick and switches when it changes, so whatever sets it (the chat's button) needs no other channel.
// It animates only while it's drawn and the window is in front. Anything else (the welcome gone, the Terminal view
// shown, another app in front) drops it to one look a second, and a look that finds it drawn again picks the
// motion back up. Shown for REST_MS with the pointer still, it rests on its last frame until the pointer moves over
// it: every frame costs the whole window a redraw, and a welcome can sit open for hours. Drawn again while it looks only
// once a second, it moves at once rather than at the next look, so a welcome doesn't open on a frozen frame.
import { View, div } from "gpui-kit";
import { theme, shared, window as appWindow } from "herdr";
import { Palette } from "./palette.js";
import { frameRuns } from "./runs.js";
import { sceneFor } from "./scenes/index.js";
import { FPS, IDLE_MS, REST_MS, cellSize } from "./config.js";
import { designPx, zoomFrom, PROBE_PX } from "../measure.js";

export class BackdropView extends View {
  init(props, cx) {
    this.dim = props?.dim ?? 1;
    this.cell = cellSize();
    this.sceneKey = props?.sceneKey ?? null;
    this.show(this.wanted());
    this.zoom = 1;
    this.px = null;
    this.rows = [];
    this.drawn = true;
    this.mode = null;
    this.stirred = Date.now();
    this.speed("fast", cx);
  }

  /** The scene shared state asks for. */
  wanted() { return sceneFor(this.sceneKey ? shared(this.sceneKey) : null).id; }

  /** Starts the scene with this id afresh (the first scene for an unknown one), on the size the view has. */
  show(id) {
    const entry = sceneFor(id);
    this.sceneId = entry.id;
    this.scene = entry.make();
    this.rows = [];
    this.size = null;
    this.stirred = Date.now();
    this.layout();
  }

  speed(mode, cx) {
    if (this.mode === mode) return;
    this.task?.cancel();
    this.mode = mode;
    this.task = cx.timer.every(mode === "fast" ? Math.round(1000 / FPS) : IDLE_MS, cx => this.tick(cx));
  }

  tick(cx) {
    // render() sets drawn; a tick that finds it unset since the last one means nothing drew this view.
    const drawn = this.drawn;
    this.drawn = false;
    // Another scene picked: start it, and move at once even if resting.
    if (this.wanted() !== this.sceneId) { this.show(this.wanted()); this.speed("fast", cx); }
    if (!drawn || !appWindow()?.active || !this.size) { this.speed("idle", cx); cx.notify(); return; }
    // Coming back into view counts as a stir; resting, it keeps its frame and looks again only to see it's shown.
    if (this.mode === "idle") this.stirred = Date.now();
    if (Date.now() - this.stirred > REST_MS) { this.speed("rest", cx); cx.notify(); return; }
    this.speed("fast", cx);
    this.scene.frame(1 / FPS, this.palette());
    this.rows = frameRuns(this.scene.grid);
    cx.notify();
  }

  palette() {
    const t = theme();
    const key = `${t.background}|${t.foreground}|${t.accent}|${t.done}`;
    if (key !== this.paletteKey) { this.paletteKey = key; this.pal = new Palette(t); }
    return this.pal;
  }

  /** The scene over the view's size (this.px, as reported: zoomed), in the unzoomed px that .w() and .left() take. */
  layout() {
    if (!this.px || !this.scene) return;
    const width = designPx(this.px.width, this.zoom), height = designPx(this.px.height, this.zoom);
    if (width < 40 || height < 40) { this.size = null; return; }
    if (this.size && Math.abs(this.size.width - width) < 1 && Math.abs(this.size.height - height) < 1) return;
    this.size = { width, height };
    const { cw, ch } = this.cell;
    this.scene.resize(width, height, cw, ch);
    this.scene.setDim(this.dim);
  }

  /** Where the pointer is, for the scene to react to (e.local_position: in the view, zoomed px). Whether it was there. */
  pointer(e, active, cx) {
    const at = e.local_position;
    if (!this.size || !at) return false;
    this.stirred = Date.now();
    if (this.mode === "rest") this.speed("fast", cx);
    const p = this.scene.pointer;
    p.x = designPx(at.x, this.zoom);
    p.y = designPx(at.y, this.zoom);
    p.active = active;
    return true;
  }

  render(cx) {
    this.drawn = true;
    // Only when that tick will move it: otherwise its idle branch redraws, this runs again, and the two loop.
    if (this.mode === "idle" && !this.waking && this.size && appWindow()?.active) {
      this.waking = true;
      cx.timer.after(0, cx => { this.waking = false; this.tick(cx); });
    }
    const { cw, ch, font } = this.cell;
    const rows = this.rows;
    const runs = [];
    for (let r = 0; r < rows.length; r++) {
      for (const u of rows[r]) {
        let el = div().absolute().left(u.col * cw).top(r * ch).w(u.len * cw).h(ch).overflow_hidden().whitespace_nowrap().child(u.text);
        if (u.fg) el = el.text_color(u.fg);
        if (u.bg) el = el.bg(u.bg);
        runs.push(el);
      }
    }
    return div().id("backdrop").absolute().inset_0().overflow_hidden()
      .font_family("JetBrains Mono").text_size(font).line_height(`${ch}px`)
      .on_size_change((size, cx) => { this.px = size; if (designPx(size.width, this.zoom) > 0) this.layout(); cx.notify(); })
      .on_mouse_move((e, cx) => this.pointer(e, true, cx))
      .on_hover((hovered, cx) => { if (!hovered) this.scene.pointer.active = false; })
      .on_mouse_down("left", (e, cx) => { if (this.pointer(e, true, cx)) this.scene.splash(this.scene.pointer.x, this.scene.pointer.y); })
      // An off-screen box that reports the app's zoom.
      .child(div().id("backdrop-zoom").absolute().top(0).left(-30000).w(PROBE_PX).h(PROBE_PX)
        .on_size_change((size, cx) => { const z = zoomFrom(size); if (Math.abs(z - this.zoom) > 0.001) { this.zoom = z; this.layout(); cx.notify(); } }))
      .children(runs);
  }

  close() { this.task?.cancel(); }
}
