// The terminal side's pane header, drawn by this mod when the layout uses it as one:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "herdr-chat" } } } }
// Herdr hands a header copy { pane, terminal } as props; the chat panel gets none of those.
// Shows the program's icon, name and folder; on hover, split / zoom / close buttons; the
// agent's status; and, for agents the chat can read, the Chat / Terminal toggle at the far right.
import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home } from "herdr";
import { SUPPORTED, ICONS, switchTo, sessionKey } from "./common.js";

function programIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.icon.endsWith(".svg") ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") || cwd.startsWith(h + "\\") ? "~" + cwd.slice(h.length) : cwd;
}

function button(t, id, glyph, command, args) {
  return div().id(id).p(3).rounded(4).flex_none().text_color(t.dim)
    .hover(s => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => { cx.stop_propagation(); run(command, args); })
    .child(svg(`${ICONS}/${glyph}.svg`).size(14));
}

export function isHeader(p) { return Boolean(p?.pane); }

// view: the mod's View, which keeps `hovered` for this copy.
export function terminalHeader(view) {
  const t = theme();
  const p = panes().find(x => x.pane === props()?.pane);
  if (!p) return div();
  const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
  const pic = programIcon(p.program, 14, t.dim);
  const st = p.status, pane = p.pane;
  return h_flex().id(`pane-head-${pane}`).size_full().px(14).gap(9).items_center()
    .bg(t.background).border_b(1).border_color(t.border).text_size(12)
    .on_hover((hovered, cx) => { view.hovered = hovered; cx.notify(); })
    .on_click(() => run("pane.focus", { pane }))
    .when(Boolean(pic), el => el.child(pic))
    .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
    .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
    .when(Boolean(view.hovered), el => el
      .child(button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
      .child(button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
      .child(button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
      .child(button(t, `ph-x-${pane}`, "close", "pane.close", { pane })))
    // Status sits right of the hover buttons, just left of the toggle.
    .when(st === "working", el => el.child(svg(`${ICONS}/spinner.svg`).size(12).flex_none().text_color(t.working).spin(900)))
    .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
    .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
    // Last, so the toggle stays at the far right whether or not the hover buttons show.
    .when(Boolean(SUPPORTED[p.app]), el => el
      .child(h_flex().flex_none().p(2).gap(2).rounded(8).bg(t.surface).border_1().border_color(t.border).text_size(12.5)
        .child(div().id(`chat-view-${pane}`).px(10).h(24).flex().items_center().rounded(6).cursor_pointer()
          .text_color(t.muted).hover(s => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); switchTo("chat", sessionKey(p.terminal)); })
          .child("Chat"))
        .child(div().id(`terminal-view-${pane}`).px(10).h(24).flex().items_center().rounded(6)
          .bg(t.selected).text_color(t.foreground).child("Terminal"))));
}
