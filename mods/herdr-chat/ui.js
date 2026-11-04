// Small pieces of the chat's look, shared by its files.
import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { settings, run } from "herdr";
import { ICONS } from "./common.js";

/** The chat column's width: messages, the question card and the reply box. */
export const COLUMN = 740;

export function icon(name, size, color) { return svg(`${ICONS}/${name}.svg`).size(size).flex_none().text_color(color); }
export function mono() { return settings().font_family || settings().font || "JetBrains Mono"; }

/** A program's icon, as herdr's program table says to draw it: a glyph in `color` when it's tinted, else a picture. */
export function programIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).size(size).flex_none();
}

/** A pane's split right, split down, zoom and close buttons, for a header shown while it's hovered. */
export function paneButtons(t, pane, zoomed, prefix) {
  const button = (id, glyph, command, args) => div().id(`${prefix}-${id}`).p(3).rounded(4).flex_none().cursor_pointer()
    .text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => { cx.stop_propagation(); run(command, args); })
    .child(svg(`${ICONS}/${glyph}.svg`).size(14));
  return [
    button("split-right", "split-right", "pane.split", { direction: "right", pane }),
    button("split-down", "split-down", "pane.split", { direction: "down", pane }),
    button("zoom", zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }),
    button("close", "close", "pane.close", { pane }),
  ];
}

/** An agent's status in a header: a spinner while working, "Needs you" when blocked, a dot when done. */
export function statusBadge(t, status) {
  if (status === "working") return svg(`${ICONS}/spinner.svg`).size(12).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") return div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26")
    .text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you");
  if (status === "done") return div().size(7).flex_none().rounded(4).bg(t.done);
  return null;
}

/** The Chat | Terminal switch: the shown view highlighted, the other one switches when clicked. */
export function viewToggle(t, shown, prefix, toChat, toTerminal) {
  const segment = (id, label, selected, go) => div().id(`${prefix}-${id}`).px(10).h(24).flex().items_center().rounded(6)
    .text_size(12.5).text_color(selected ? t.foreground : t.muted).when(selected, el => el.bg(t.selected))
    .when(!selected, el => el.cursor_pointer().hover(s => s.text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); go(); }))
    .child(label);
  return h_flex().flex_none().p(2).gap(2).rounded(8).bg(t.surface).border_1().border_color(t.border)
    .child(segment("chat", "Chat", shown === "chat", toChat))
    .child(segment("terminal", "Terminal", shown === "terminal", toTerminal));
}

/** A time as the clock shows it (3:42 PM). */
export function clock(ms) {
  const d = new Date(ms), h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
