import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { switchTo, sessionOf } from "./common.js";
import { target, readPrompt, pressKeys } from "./terminal.js";
import { parseChoices } from "./prompts.js";
import { COLUMN, mono } from "./ui.js";

export const ChoiceMethods = {
  async promptStillCurrent(t) {
    // Whether the prompt shown is still the one on screen.
    if (target()?.address !== t.address) return false;
    const text = await readPrompt(t);
    if (text == null) return false;
    if (this.choices) return parseChoices(text)?.sig === this.choices.sig;
    return target()?.status === "blocked" && Boolean(this.screen) && text === this.screen;
  },

  choose(index, cx) {
    // Picks a choice of the prompt on screen: from the selected one, ↑ or ↓ to it, then Enter.
    const t = target(), shown = this.choices;
    if (!t || !shown || this.sending) return;
    this.sending = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const text = await readPrompt(t);
        const now = text != null ? parseChoices(text) : null;
        if (!now || now.sig !== shown.sig || target()?.address !== t.address) throw new Error("The question changed. Review it again before answering.");
        const from = now.options.findIndex(o => o.selected);
        const moves = Array(Math.abs(index - from)).fill(index > from ? "down" : "up");
        const r = await pressKeys(t, [...moves, "enter"]);
        if (r.code !== 0) throw new Error(r.stderr || "Key send failed");
        this.choices = null; this.screen = "";
      } catch (e) { this.note = String(e?.message ?? e); }
      finally { this.sending = false; cx.notify(); }
    });
  },

  press(key, cx) {
    const t = target();
    if (!t || this.sending) return;
    this.sending = true; cx.notify();
    cx.spawn(async cx => {
      try {
        if (key !== "esc" && !(await this.promptStillCurrent(t))) throw new Error("The prompt changed. Review it again before answering.");
        const r = await pressKeys(t, [key]);
        if (r.code !== 0) throw new Error(r.stderr || "Key send failed");
      } catch (e) { this.note = String(e); }
      finally { this.sending = false; cx.notify(); }
    });
  },

  promptCard(t, active) {
    // The card for a prompt on screen: a question with its choices, or a blocked agent's last lines.
    const q = active && (active.status === "blocked" || active.status === "working") ? this.choices : null;
    if (active?.status !== "blocked" && !q) return null;
    const key = (id, label, k) => div().id(id).h(30).px(12).flex().items_center().rounded(8).cursor_pointer()
      .border_1().border_color(t.border).bg(t.background).text_size(12.5).text_color(t.foreground)
      .hover(s => s.bg(t.hover)).on_click((_e, cx) => k === "terminal" ? switchTo("terminal", active ? sessionOf(active) : "") : this.press(k, cx)).child(label);
    return v_flex().w_full().max_w(COLUMN).p(14).gap(10).rounded(14).border_1().border_color(t.blocked).bg(t.surface)
      .child(h_flex().gap(8).items_center()
        .child(div().size(8).rounded(4).bg(t.blocked))
        .child(div().text_size(13.5).font_semibold().text_color(t.foreground).child(q ? `${active.label} is asking` : `${active.label} needs your input`)))
      .when(Boolean(q), el => el
        .when(Boolean(q.tabs), el => el.child(div().text_size(11.5).text_color(t.dim).truncate().child(q.tabs)))
        .when(q.question.length > 1, el => el.child(div().max_h(110).overflow_y_scrollbar().px(10).py(6).rounded(8).bg(t.background)
          .font_family(mono()).text_size(11.5).text_color(t.muted).child(q.question.slice(0, -1).join("\n"))))
        .child(div().text_size(14).text_color(t.foreground).child(q.question.at(-1) ?? ""))
        .child(v_flex().gap(6).children(q.options.map((o, i) => v_flex().id(`choice-${i}`).w_full().px(12).py(8).gap(2).rounded(10)
          .border_1().border_color(o.selected ? t.accent : t.border).bg(t.background).cursor_pointer()
          .hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(i, cx))
          .child(h_flex().gap(8).items_start()
            .child(div().flex_none().text_size(13).text_color(t.dim).child(`${o.n}.`))
            .child(div().flex_1().min_w(0).text_size(13.5).text_color(t.foreground).child(o.label)))
          .when(o.desc.length > 0, el => el.child(div().pl(20).text_size(12).text_color(t.muted).child(o.desc.join(" ")))))))
        .when(q.more, el => el.child(div().text_size(11.5).text_color(t.dim).child("More choices below: use ↓ or open the terminal."))))
      .when(!q, el => el.child(div().max_h(220).overflow_y_scrollbar().px(10).py(8).rounded(8).bg(t.background)
        .font_family(mono()).text_size(12).text_color(t.muted)
        .child(this.screen ? this.screen.split("\n").filter(l => l.trim()).slice(-12).join("\n") : "Open the terminal to review the request.")))
      .child(h_flex().gap(6).flex_wrap()
        .child(key("k-up", "↑", "up")).child(key("k-down", "↓", "down"))
        .child(key("k-enter", "Enter", "enter")).child(key("k-esc", "Esc", "esc"))
        .child(div().flex_1())
        .child(key("k-term", "Open terminal", "terminal")));
  },
};
