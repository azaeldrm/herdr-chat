import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { readFile, writeFile } from "fs/promises";
import { theme, props, appHome, openOverlay, closeOverlay } from "herdr";
import { icon } from "../ui/primitives.js";
import { designPx, zoomProbe } from "../measure.js";
import { onWindows } from "../platform.js";
import { copyDiagramImage } from "../diagrams.js";

const STEP = 1.25, MIN = 0.25, MAX = 4, FIT_MAX = 2;
// Herdr rasterizes an SVG drawn by image() once, at its own width/height × 2, and keeps that bitmap for the path, so a
// bigger draw is a stretched bitmap. Sharp zoom draws a copy of the SVG with width/height × 2, 4 or 8 (viewBox kept):
// the smallest one at least as big as the zoom, within what a GPU texture holds.
const BUCKETS = [1, 2, 4, 8];
const RASTER_SIDE = 8192, RASTER_AREA = 32e6;

function filePath(rel) { return onWindows() ? `${appHome()}\\${rel.replace(/\//g, "\\")}` : `${appHome()}/${rel}`; }

export function scaledSvg(svg, k) {
  // The SVG with its root width and height × k; its viewBox keeps the drawing the same.
  return svg.replace(/<svg\s[^>]*>/, tag => tag
    .replace(/\swidth="([\d.]+)"/, (_a, w) => ` width="${+w * k}"`)
    .replace(/\sheight="([\d.]+)"/, (_a, h) => ` height="${+h * k}"`));
}

export function isDiagramViewer(p) { return Boolean(p?.diagram); }

export function openDiagram(d) {
  // A drawn diagram (diagramFor, ready) in a dialog of its own, at a readable size, scrolled in both directions.
  openOverlay({ mod: "herdr-chat", kind: "dialog", width: 0.92, height: 0.9,
    props: { diagram: d.rel, width: d.width, height: d.height, key: d.key, source: d.source } });
}

export class DiagramViewer {
  // The dialog's view: the diagram, its zoom (− / percent / +; the percent fits it), and a close button.
  constructor(cx) {
    const p = props();
    this.rel = p.diagram; this.w = Math.max(1, p.width || 1); this.h = Math.max(1, p.height || 1);
    this.zoom = 1; this.box = null; this.scale = null;
    this.ready = new Set([1]); this.making = new Set(); this.shown = 1; this.under = 1;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  fit() {
    // The scale that shows it whole in the box, up to FIT_MAX; until the box is measured, small enough not to spill.
    if (!this.box) return MIN;
    return Math.min(FIT_MAX, (this.box.width - 32) / this.w, (this.box.height - 32) / this.h);
  }

  flash(mark, cx) {
    this.copied = mark; cx.notify();
    cx.timer.after(1500, cx => { if (this.copied === mark) { this.copied = null; cx.notify(); } });
  }

  copyCode(cx) {
    const source = props()?.source;
    if (!source) return;
    cx.write_to_clipboard(source);
    this.flash("code", cx);
  }

  copyImage(cx) {
    const p = props() ?? {};
    if (!p.key || this.copied === "image-busy") return;
    this.copied = "image-busy"; this.copyNote = null; cx.notify();
    cx.spawn(async cx => {
      const error = await copyDiagramImage({ key: p.key, width: this.w, height: this.h }, String(theme().background ?? "#000000").slice(0, 7));
      if (error) { this.copied = null; this.copyNote = error; cx.notify(); }
      else this.flash("image", cx);
    });
  }

  setScale(s, cx) { this.scale = Math.min(MAX, Math.max(MIN, s)); cx.notify(); }

  relFor(k) { return k === 1 ? this.rel : this.rel.replace(/\.svg$/, `@${k}x.svg`); }

  bucketFor(scale) {
    // The smallest copy whose bitmap is at least as big as it's drawn (scale × the app's zoom), within the texture limits.
    const fits = BUCKETS.filter(k => this.w * k * 2 <= RASTER_SIDE && this.h * k * 2 <= RASTER_SIDE && this.w * this.h * k * k * 4 <= RASTER_AREA);
    return fits.find(k => k >= scale * this.zoom) ?? fits[fits.length - 1] ?? 1;
  }

  make(k, cx) {
    // Writes the k× copy beside the diagram, once; drawn once it's there.
    if (this.ready.has(k) || this.making.has(k)) return;
    this.making.add(k);
    cx.spawn(async cx => {
      try {
        await writeFile(filePath(this.relFor(k)), scaledSvg(await readFile(filePath(this.rel), "utf8"), k));
        this.ready.add(k);
      } catch {} finally { this.making.delete(k); cx.notify(); }
    });
  }

  render(cx) {
    const t = theme();
    // Until zoomed by hand: whole in the box (zoom in and scroll to read the details).
    const scale = this.scale ?? this.fit();
    const want = this.bucketFor(scale);
    if (this.ready.has(want)) { if (want !== this.shown) { this.under = this.shown; this.shown = want; } }
    else this.make(want, cx);
    const w = Math.round(this.w * scale), h = Math.round(this.h * scale);
    // The copy drawn before stays under the new one while it loads, so a switch never shows a blank frame.
    const layer = k => image(this.relFor(k)).absolute().top(0).left(0).w(w).h(h);
    const button = (id, child, onClick, tip) => div().id(id).h(26).min_w(26).px(6).flex().items_center().justify_center()
      .rounded(6).cursor_pointer().text_size(12).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip).on_click((_e, cx) => onClick(cx)).child(child);
    return v_flex().id("herdr-chat-diagram").size_full().min_w(0).min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        if (e.key === "+" || e.key === "=") this.setScale(scale * STEP, cx);
        else if (e.key === "-") this.setScale(scale / STEP, cx);
        else if (e.key === "0") this.setScale(this.fit(), cx);
      })
      .child(zoomProbe((zoom, cx) => { if (Math.abs(zoom - this.zoom) > 0.001) { this.zoom = zoom; cx.notify(); } }))
      .child(h_flex().h(42).flex_none().px(12).gap(4).items_center().border_b_1().border_color(t.border)
        .child(div().flex_1().text_size(13).text_color(t.muted).child(this.copyNote ?? "Diagram"))
        // Copy image (the drawn diagram as a PNG, on the theme's background) and Copy code (its mermaid source).
        .child(button("copy-image", h_flex().gap(5).items_center().child(icon(this.copied === "image" ? "check" : "image", 13, t.muted))
          .child(this.copied === "image" ? "Copied" : this.copied === "image-busy" ? "Copying…" : "Copy image"), cx => this.copyImage(cx), "Copy the diagram as a picture"))
        .child(button("copy-code", h_flex().gap(5).items_center().child(icon(this.copied === "code" ? "check" : "copy", 13, t.muted))
          .child(this.copied === "code" ? "Copied" : "Copy code"), cx => this.copyCode(cx), "Copy the diagram's mermaid code"))
        .child(div().w(8))
        .child(button("zoom-out", "−", cx => this.setScale(scale / STEP, cx), "Zoom out (-)"))
        .child(button("zoom-fit", `${Math.round(scale * 100)}%`, cx => this.setScale(this.fit(), cx), "Fit (0)"))
        .child(button("zoom-in", "+", cx => this.setScale(scale * STEP, cx), "Zoom in (+)"))
        .child(div().w(8))
        .child(button("close", icon("close", 14, t.muted), () => closeOverlay(props().overlay), "Close (Esc)")))
      .child(div().id("herdr-chat-diagram-body").flex_1().w_full().min_w(0).min_h(0).overflow_scrollbar()
        .on_size_change((size, cx) => {
          const box = { width: designPx(size.width, this.zoom), height: designPx(size.height, this.zoom) };
          if (!this.box || Math.abs(box.width - this.box.width) > 4 || Math.abs(box.height - this.box.height) > 4) { this.box = box; cx.notify(); }
        })
        .child(div().p(16).flex_none().child(div().relative().w(w).h(h)
          .when(this.under !== this.shown, el => el.child(layer(this.under)))
          .child(layer(this.shown)))));
  }
}
