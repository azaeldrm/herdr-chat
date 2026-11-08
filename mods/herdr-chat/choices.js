import { div } from "gpui-kit";
import { v_flex, h_flex, Textarea } from "gpui-base";
import { switchTo, sessionOf } from "./common.js";
import { target, readPrompt, pressKeys, sendMessage, inputBox } from "./terminal.js";
import { parsePrompt, keysFor, typedAnswer, sameOption } from "./prompts.js";
import { COLUMN, mono, icon } from "./ui.js";

const BODY_HEIGHT = 264;
const ROW_CHARS = 96;
const DESC_CHARS = 110;
const ROW_PAUSE = 500;
const SCROLL_TRIES = 12;

function checkbox(t, checked) {
  // A multi-select row's box.
  return div().flex_none().size(12).flex().items_center().justify_center().rounded(3).border_1()
    .border_color(checked ? t.accent : t.dim).bg(checked ? t.accent : t.background)
    .text_size(9).text_color(t.background).child(checked ? "✓" : "");
}

function stacked(o) {
  // Whether an option's description needs a line of its own.
  return o.desc.length > 0 && o.label.length + o.desc.join(" ").length > ROW_CHARS;
}

function bodyHeight(q) {
  // The height of a prompt's answers and options, up to where they scroll.
  const shown = q.options.filter(o => !o.next);
  const rows = shown.reduce((sum, o) => sum + 34 + (stacked(o) ? Math.ceil(o.desc.join(" ").length / DESC_CHARS) * 19 : 0), 0) + (shown.length - 1) * 6;
  const answers = q.review?.answers.length ? q.review.answers.length * 21 + 24 : 0;
  return Math.min(BODY_HEIGHT, rows + answers);
}

export const ChoiceMethods = {
  async promptStillCurrent(t) {
    // Whether the prompt shown is still the one on screen.
    if (target()?.address !== t.address) return false;
    const text = await readPrompt(t);
    if (text == null) return false;
    if (this.choices) return parsePrompt(t.app, text)?.sig === this.choices.sig;
    return (target()?.status === "blocked" || this.unread) && Boolean(this.screen) && text === this.screen;
  },

  choose(index, cx) {
    // Acts on a choice of the prompt on screen, with the keys its harness takes.
    const t = target(), shown = this.choices;
    if (!t || !shown || this.sending) return;
    this.sending = true; cx.notify();
    cx.spawn(async cx => {
      try {
        await this.flushRow(t, cx);
        const text = await readPrompt(t);
        const now = text != null ? parsePrompt(t.app, text) : null;
        if (!now || now.sig !== shown.sig || target()?.address !== t.address) throw new Error("The question changed. Review it again before answering.");
        const at = now.options.findIndex(o => sameOption(shown.options[index], o));
        if (at < 0) throw new Error("The question changed. Review it again before answering.");
        const r = await pressKeys(t, keysFor(t.app, now, at));
        if (r.code !== 0) throw new Error(r.stderr || "Key send failed");
        if (!now.multi) { this.choices = null; this.screen = ""; this.unread = false; }
      } catch (e) { this.note = String(e?.message ?? e); }
      finally { this.sending = false; cx.notify(); this.lookAgain(cx, t); }
    });
  },

  rowChanged(kind, cx) {
    // Keeps a multi-select's text row on the terminal as it's typed, once typing pauses.
    const t = target();
    if (kind !== "text" || !this.choices?.multi || this.rowSetting || !t) return;
    this.rowDirty = true;
    this.rowEditedAt = Date.now();
    const token = this.rowToken = (this.rowToken ?? 0) + 1;
    cx.notify();
    cx.spawn(async cx => {
      await cx.sleep(ROW_PAUSE);
      if (token !== this.rowToken) return;
      await this.flushRow(t, cx);
      this.lookAgain(cx, t);
    });
  },

  async revealRow(t, cx) {
    // The prompt with its text row on screen, scrolling a list cut off below it.
    const read = async () => { const screen = await readPrompt(t); return screen != null ? parsePrompt(t.app, screen) : null; };
    let now = await read();
    for (let i = 0; i < SCROLL_TRIES && now?.options.find(o => o.input === "text")?.hidden; i++) {
      await pressKeys(t, ["down"]);
      await cx.sleep(200);
      now = await read();
    }
    return now;
  },

  flushRow(t, cx) {
    // Puts a multi-select's typed text on the terminal, where text ticks the row and no text unticks it.
    this.rowChain = (this.rowChain ?? Promise.resolve()).then(async () => {
      if (!this.rowDirty) return;
      this.rowDirty = false;
      const now = await this.revealRow(t, cx);
      const index = now?.options.findIndex(o => o.input === "text" && !o.hidden) ?? -1;
      if (index < 0) return;
      const { before } = typedAnswer(t.app, now, index);
      if (before.length) await pressKeys(t, before);
      await cx.sleep(150);
      await inputBox("fill", t, this.rowInputs.text.value().trim());
      this.rowEditedAt = Date.now();
      await cx.sleep(300);
    }).catch(e => { this.note = String(e?.message ?? e); });
    return this.rowChain;
  },

  answerRow(kind, cx) {
    // Sends what's typed in a text row of the prompt; an empty row is picked like any choice.
    const shown = this.choices, index = shown?.options.findIndex(o => o.input === kind) ?? -1;
    if (index < 0) return;
    const box = this.rowInputs[kind], text = box.value().trim();
    const t = target();
    if (shown.multi && kind === "text") {
      if (t) cx.spawn(async cx => { this.rowToken = (this.rowToken ?? 0) + 1; await this.flushRow(t, cx); this.lookAgain(cx, t); });
      return;
    }
    if (!text) { this.choose(index, cx); return; }
    if (!t || this.sending) return;
    this.sending = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const now = kind === "text" ? await this.revealRow(t, cx) : parsePrompt(t.app, (await readPrompt(t)) ?? "");
        if (!now || now.sig !== shown.sig || target()?.address !== t.address) throw new Error("The question changed. Review it again before answering.");
        const at = now.options.findIndex(o => o.input === kind && !o.hidden);
        if (at < 0) throw new Error("Couldn't reach that row. Open the terminal to answer.");
        const { before } = typedAnswer(t.app, now, at);
        const moved = await pressKeys(t, before);
        if (moved.code !== 0) throw new Error(moved.stderr || "Key send failed");
        await cx.sleep(300);
        const sent = await sendMessage(t, text, true);
        if (sent.code !== 0) throw new Error(sent.stderr || "Send failed");
        box.set_value("");
        this.choices = null; this.screen = ""; this.unread = false;
      } catch (e) { this.note = String(e?.message ?? e); }
      finally { this.sending = false; cx.notify(); this.lookAgain(cx, t); }
    });
  },

  press(key, cx) {
    const t = target();
    if (!t || this.sending) return;
    this.sending = true; cx.notify();
    cx.spawn(async cx => {
      try {
        if (key !== "esc") await this.flushRow(t, cx);
        if (key !== "esc" && !(await this.promptStillCurrent(t))) throw new Error("The prompt changed. Review it again before answering.");
        const r = await pressKeys(t, [key]);
        if (r.code !== 0) throw new Error(r.stderr || "Key send failed");
      } catch (e) { this.note = String(e); }
      finally { this.sending = false; cx.notify(); this.lookAgain(cx, t); }
    });
  },

  lookAgain(cx, t) {
    // Reads the screen soon after keys, since a blocked agent reports no change when a question moves on.
    cx.spawn(async cx => {
      for (const ms of [250, 700]) {
        await cx.sleep(ms);
        if (target()?.address === t.address) this.readQuestion(cx, target());
      }
    });
  },

  toggleCard(cx) {
    // Folds the prompt card down to its title row, or opens it again.
    this.cardFolded = !this.cardFolded;
    if (this.following) this.follow();
    cx.notify();
  },

  promptCard(t, active) {
    // The card for a prompt on screen: a question with its choices, or a blocked agent's last lines.
    const q = active && (active.status === "blocked" || active.status === "working") ? this.choices : null;
    if (active?.status !== "blocked" && !q && !this.unread) return null;
    const fold = q ? JSON.stringify(q.steps.length ? q.steps.map(s => s.label) : q.question) : `screen:${active?.address}`;
    if (fold !== this.cardFold) { this.cardFold = fold; this.cardFolded = false; }
    const title = active.kind === "permission" ? `${active.label} needs permission` : q ? `${active.label} is asking` : `${active.label} needs your input`;
    const titleRow = h_flex().id("card-title").gap(8).items_center().cursor_pointer().on_click((_e, cx) => this.toggleCard(cx))
      .child(div().size(7).rounded(4).flex_none().bg(t.blocked))
      .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
      .when(this.cardFolded && Boolean(q?.question.at(-1)), el => el.child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child(`· ${q.question.at(-1)}`)))
      .when(!this.cardFolded, el => el.child(div().flex_1()))
      .child(icon(this.cardFolded ? "chevron-right" : "chevron-down", 14, t.dim));
    if (this.cardFolded) return v_flex().flex_none().w_full().max_w(COLUMN).px(10).py(8).rounded(12).border_1().border_color(t.blocked).bg(t.surface).child(titleRow);
    const key = (id, label, k) => div().id(id).h(24).px(9).flex().items_center().rounded(6).cursor_pointer()
      .border_1().border_color(t.border).bg(t.background).text_size(12).text_color(t.foreground)
      .hover(s => s.bg(t.hover)).on_click((_e, cx) => k === "terminal" ? switchTo("terminal", active ? sessionOf(active) : "") : this.press(k, cx)).child(label);
    return v_flex().flex_none().w_full().max_w(COLUMN).p(10).gap(7).rounded(12).border_1().border_color(t.blocked).bg(t.surface)
      .child(titleRow)
      .when(Boolean(q), el => el
        .when(q.steps.length > 0, el => el.child(h_flex().gap(2).items_center().flex_wrap()
          .child(key("k-back", "←", "left"))
          .children(q.steps.map((s, i) => {
            const here = q.steps.length === 1 || s.label === this.currentStep;
            return div().id(`step-${i}`).h(24).px(9).flex().items_center().rounded(6).text_size(12)
              .text_color(here ? t.foreground : s.done ? t.accent : t.muted)
              .when(here, el => el.bg(t.selected))
              .child(s.label);
          }))
          .child(key("k-forward", "→", "right"))))
        .when(q.question.length > 1, el => el.child(div().flex_none().h(Math.min(90, q.question.slice(0, -1).length * 17 + 10)).overflow_y_scrollbar().px(8).py(4).rounded(6).bg(t.background)
          .font_family(mono()).text_size(11).text_color(t.muted).child(q.question.slice(0, -1).join("\n"))))
        .child(div().text_size(13).text_color(t.foreground).child(q.question.at(-1) ?? ""))
        .when(Boolean(q.review?.warning), el => el.child(div().text_size(11.5).text_color(t.blocked).child(q.review.warning)))
        .child(v_flex().id("prompt-body").flex_none().w_full().h(bodyHeight(q)).overflow_y_scrollbar().gap(6)
          .when(Boolean(q.review?.answers.length), el => el.child(v_flex().flex_none().gap(2).px(10).py(6).rounded(8).bg(t.background)
            .children(q.review.answers.map(a => h_flex().gap(8).items_baseline()
              .child(div().flex_none().w(150).truncate().text_size(11.5).text_color(t.muted).child(a.question))
              .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(a.answer || "Not answered"))))))
          .children(q.options.map((o, i) => o.next ? null : o.input ? v_flex().id(`choice-${i}`).flex_none().w_full().px(10).py(5).rounded(7)
          .border_1().border_color(t.border).bg(t.background)
          .child(h_flex().gap(7).items_center()
            .child(o.checked === undefined
              ? div().flex_none().text_size(12).text_color(t.dim).child(o.n ? `${o.n}.` : "")
              : checkbox(t, Boolean(this.rowInputs.text.value().trim())))
            .child(div().flex_1().min_w(0).child(Textarea.new(this.rowInputs[o.input]).w_full().text_size(12.5).text_color(t.foreground))))
          : v_flex().id(`choice-${i}`).flex_none().w_full().px(10).py(5).rounded(7)
          .border_1().border_color((q.options.some(x => x.answered) ? o.answered : o.selected) ? t.accent : t.border).bg(t.background).cursor_pointer()
          .hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(i, cx))
          .child(h_flex().gap(7).items_center()
            .child(o.checked === undefined
              ? div().flex_none().text_size(12).text_color(t.dim).child(o.n ? `${o.n}.` : "→")
              : checkbox(t, o.checked))
            .child(div().when(o.desc.length > 0 && !stacked(o), el => el.flex_none()).when(o.desc.length === 0 || stacked(o), el => el.flex_1().min_w(0)).text_size(12.5).text_color(t.foreground).child(o.label))
            .when(o.desc.length > 0 && !stacked(o), el => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(o.desc.join(" "))))
            .when(Boolean(o.answered), el => el.child(div().flex_none().text_size(12).text_color(t.accent).child("✓"))))
          .when(stacked(o), el => el.child(div().pl(19).text_size(11.5).text_color(t.muted).child(o.desc.join(" "))))).filter(Boolean)))
        .when(q.more, el => el.child(div().text_size(11.5).text_color(t.dim).child("More choices below: use ↓ or open the terminal."))))
      .when(!q, el => el.child(div().max_h(220).overflow_y_scrollbar().px(10).py(8).rounded(8).bg(t.background)
        .font_family(mono()).text_size(12).text_color(t.muted)
        .child(this.screen ? this.screen.split("\n").filter(l => l.trim()).slice(-12).join("\n") : "Open the terminal to review the request.")))
      .child(h_flex().gap(6).flex_wrap()
        .when(!q || q.more, el => el.child(key("k-up", "↑", "up")).child(key("k-down", "↓", "down")))
        .when(!q, el => el.child(key("k-enter", "Enter", "enter")))
        .child(key("k-esc", "Esc", "esc"))
        .when(Boolean(q?.options.some(o => o.next)), el => el.child(div().id("k-next").h(24).px(9).flex().items_center().rounded(6).cursor_pointer()
          .border_1().border_color(t.accent).bg(t.background).text_size(12).text_color(t.foreground)
          .hover(s => s.bg(t.hover)).on_click((_e, cx) => this.choose(q.options.findIndex(o => o.next), cx)).child("Next →")))
        .child(div().flex_1())
        .child(key("k-term", "Open terminal", "terminal")));
  },
};
