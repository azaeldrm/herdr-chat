import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { sessionOf } from "../common.js";
import { skillToken, matchSkills, withSkill, parseSkills } from "../model/skills.js";
import { readSkills } from "./session-reader.js";
import { mono } from "../ui/primitives.js";

const ROWS = 8;
const FRESH_MS = 30000;

export class SkillMenu {
  constructor(host) {
    // The list of an agent's skills above the reply box, as the agent's own terminal offers them. `host` is the composer: its `input` and `keepDraft`. Lists load in the background and filter in memory, so typing never waits.
    this.host = host;
    this.lists = new Map();
    this.index = 0;
  }

  warm(t, path, cx) {
    // Keeps the shown agent's list fresh: on switching to it, when its session starts, and every so often while the menu shows.
    if (!t?.harness.skills) return;
    const key = sessionOf(t), have = this.lists.get(key);
    const open = Boolean(this.view(t));
    if (have && (have.loading || (have.path === path && (!open || Date.now() - have.at < FRESH_MS)))) return;
    const entry = { items: have?.items ?? [], at: have?.at ?? 0, path, loading: true };
    this.lists.set(key, entry);
    cx.spawn(async cx => {
      const r = await readSkills(t, path).catch(() => null);
      if (r?.code === 0) entry.items = parseSkills(r.stdout);
      entry.at = Date.now(); entry.loading = false;
      cx.notify();
    });
  }

  view(t) {
    // What the menu shows now: the token being typed and its matches, or null when it's closed.
    const skills = t?.harness.skills;
    if (!skills) return null;
    const text = this.host.input.value();
    if (text === this.dismissed) return null;
    const token = skillToken(text, skills.triggers);
    if (!token) return null;
    const items = matchSkills(this.lists.get(sessionOf(t))?.items ?? [], token.query, skills.invoke);
    if (!items.length) return null;
    if (token.query !== this.lastQuery) { this.lastQuery = token.query; this.index = 0; }
    this.index = Math.min(this.index, items.length - 1);
    return { token, items, invoke: skills.invoke };
  }

  move(t, dir, cx) {
    // ↑ or ↓ while it's open moves the selection, wrapping; false when it's closed.
    const v = this.view(t);
    if (!v) return false;
    this.index = (this.index + dir + v.items.length) % v.items.length;
    cx.notify();
    return true;
  }

  accept(t, cx, index = this.index) {
    // Puts the skill in the box; false when the menu is closed.
    const v = this.view(t);
    if (!v) return false;
    const text = withSkill(this.host.input.value(), v.token, v.invoke, v.items[index].name);
    this.host.input.set_value(text);
    this.host.input.set_selected_range({ start: text.length, end: text.length });
    this.host.input.focus();
    this.host.keepDraft(cx);
    cx.notify();
    return true;
  }

  dismiss(t, cx) {
    // Esc closes it until the text changes; false when it's closed.
    if (!this.view(t)) return false;
    this.dismissed = this.host.input.value();
    cx.notify();
    return true;
  }

  render(t, active) {
    // The menu, floating above the reply box so the conversation doesn't move; null when it's closed.
    const v = this.view(active);
    if (!v) return null;
    const first = Math.max(0, Math.min(this.index - Math.floor(ROWS / 2), v.items.length - ROWS));
    return v_flex().id("skill-menu").absolute().bottom_full().left(0).right(0).mb(6).p(4).rounded(14).border_1().border_color(t.border).bg(t.surface)
      .children(v.items.slice(first, first + ROWS).map((s, i) => {
        const at = first + i, chosen = at === this.index;
        return h_flex().id(`skill-${s.name}`).w_full().h(32).px(10).gap(12).items_center().rounded(9).cursor_pointer().border_1().border_color(chosen ? t.accent : "#00000000")
          .when(chosen, el => el.bg(t.raised)).hover(st => st.bg(t.raised))
          .on_click((_e, cx) => { cx.stop_propagation(); this.accept(active, cx, at); })
          .child(div().flex_none().text_size(13).font_family(mono()).text_color(chosen ? t.accent : t.foreground).child(`${v.invoke}${s.name}`))
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(chosen ? t.foreground : t.muted).child(s.description))
          .when(s.source === "project", el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(s.source)));
      }))
      .child(div().w_full().px(10).pt(4).pb(2).text_size(11).text_color(t.dim)
        .child(`${v.items.length} skill${v.items.length === 1 ? "" : "s"} · ↑↓ to choose · Enter or Tab to insert · Esc to close`));
  }
}
