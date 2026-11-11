import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, props, openOverlay, closeOverlay } from "herdr";
import { icon } from "../ui/primitives.js";
import { designPx, zoomProbe } from "../measure.js";

const STEP = 1.25, MIN = 0.25, MAX = 4, FIT_MAX = 2;

export function isDiagramViewer(p) { return Boolean(p?.diagram); }

export function openDiagram(d) {
  // A drawn diagram (diagramFor, ready) in a dialog of its own, at a readable size, scrolled in both directions.
  openOverlay({ mod: "herdr-chat", kind: "dialog", width: 0.92, height: 0.9,
    props: { diagram: d.rel, width: d.width, height: d.height } });
}

export class DiagramViewer {
  // The dialog's view: the diagram, its zoom (− / percent / +; the percent fits it), and a close button.
  constructor(cx) {
    const p = props();
    this.rel = p.diagram; this.w = Math.max(1, p.width || 1); this.h = Math.max(1, p.height || 1);
    this.zoom = 1; this.box = null; this.scale = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  fit() {
    // The scale that shows it whole in the box, up to FIT_MAX; until the box is measured, small enough not to spill.
    if (!this.box) return MIN;
    return Math.min(FIT_MAX, (this.box.width - 32) / this.w, (this.box.height - 32) / this.h);
  }

  setScale(s, cx) { this.scale = Math.min(MAX, Math.max(MIN, s)); cx.notify(); }

  render() {
    const t = theme();
    // Until zoomed by hand: whole in the box (zoom in and scroll to read the details).
    const scale = this.scale ?? this.fit();
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
        .child(div().flex_1().text_size(13).text_color(t.muted).child("Diagram"))
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
        .child(div().p(16).flex_none().child(image(this.rel).w(Math.round(this.w * scale)).h(Math.round(this.h * scale)))));
  }
}
