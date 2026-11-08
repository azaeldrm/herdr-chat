import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home } from "herdr";
import { SUPPORTED, switchTo, sessionKey } from "./common.js";
import { programIcon, paneButtons, statusBadge, viewToggle } from "./ui/primitives.js";

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") || cwd.startsWith(h + "\\") ? "~" + cwd.slice(h.length) : cwd;
}

export function isHeader(p) { return Boolean(p?.pane); }

export function terminalHeader(view) {
  const t = theme();
  const p = panes().find(x => x.pane === props()?.pane);
  if (!p) return div();
  const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
  const pic = programIcon(p.program, 14, t.dim), badge = statusBadge(t, p.status), pane = p.pane;
  return h_flex().id(`pane-head-${pane}`).size_full().px(14).gap(9).items_center()
    .bg(t.background).border_b(1).border_color(t.border).text_size(12)
    .on_hover((hovered, cx) => { view.hovered = hovered; cx.notify(); })
    .on_click(() => run("pane.focus", { pane }))
    .when(Boolean(pic), el => el.child(pic))
    .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
    .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
    .when(Boolean(view.hovered), el => el.children(paneButtons(t, pane, p.zoomed, `ph-${pane}`)))
    .when(Boolean(badge), el => el.child(badge))
    .when(Boolean(SUPPORTED[p.app]), el => el.child(viewToggle(t, "terminal", `view-${pane}`, () => switchTo("chat", sessionKey(p.terminal)), () => {})));
}
