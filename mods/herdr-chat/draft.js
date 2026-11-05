import { shared } from "herdr";
import { sessionOf } from "./common.js";
import { target, inputBox } from "./terminal.js";
import { canMirror, draftPastes, textOfBox, readBack } from "./agents.js";

export const DraftMethods = {
  mirrorOnSwitch(cx) {
    // The chat box and the agent's own input box hold the same draft.
    const mode = shared("herdr-chat.mode"), t = target();
    const session = t ? sessionOf(t) : "";
    const was = this.lastMode, wasSession = this.lastModeSession;
    this.lastMode = mode; this.lastModeSession = session;
    if (mode === "chat" && was !== "chat") this.input.focus();
    if (mode === was || !t || session !== wasSession || !canMirror(t.app) || this.sending || this.choices) return;
    if (was === "chat" && mode === "terminal") this.pushDraft(t, session, cx);
    else if (was === "terminal" && mode === "chat") this.pullDraft(t, session, cx);
  },

  queueMirror(cx, step) {
    // One mirror step at a time: a quick switch back waits for the push before reading the box.
    this.mirrorChain = this.mirrorChain.then(() => new Promise(done => cx.spawn(async cx => {
      try { await step(cx); } catch {} finally { done(); }
    })));
  },

  pushDraft(t, session, cx) {
    const text = this.input.value(), images = this.attachments.slice();
    const sig = `${text}\u0000${images.map(a => a.file).join("|")}`;
    if (this.mirror?.session === session && this.mirror.sig === sig) return;
    this.queueMirror(cx, async () => {
      const paths = await this.placeImages(t, images);
      const { pastes, pasted } = draftPastes(t.app, paths, text);
      const r = await inputBox("set", t, t.app, JSON.stringify(pastes));
      if (!r.ok) return;
      const box = r.box ?? "";
      const textBox = textOfBox(t.app, box);
      this.mirror = { session, sig, images, paths, pasted, textBox, box, foreign: false };
    });
  },

  pullDraft(t, session, cx) {
    // The agent's box back into the chat.
    this.queueMirror(cx, async cx => {
      const r = await inputBox("read", t, t.app);
      if (!r.ok) return;
      const box = r.box;
      if (box == null || target()?.address !== t.address || shared("herdr-chat.mode") !== "chat") return;
      const m = this.mirror?.session === session ? this.mirror : null;
      if (m && box === m.box) return;
      const { text, kept, foreign } = readBack(t.app, box, m);
      if (foreign) {
        this.mirror = { ...(m ?? { session, sig: "", images: [], paths: [], pasted: "", textBox: "" }), box, foreign: true };
        this.note = `${t.label}'s input box has an image that was pasted into the terminal itself, and ${t.label} keeps that image where the chat can't read it. Send that draft from the Terminal view, or remove the image there.`;
        cx.notify();
        return;
      }
      const dropped = this.attachments.filter(a => m?.images.includes(a) && !kept.includes(a));
      this.forget(dropped.map(a => a.file));
      this.attachments = [...new Set([...kept, ...this.attachments.filter(a => !m?.images.includes(a))])];
      if (text !== this.input.value()) this.input.set_value(text);
      const sig = `${text}\u0000${this.attachments.map(a => a.file).join("|")}`;
      this.mirror = { ...(m ?? { session, images: [], paths: [], pasted: "", textBox: "" }), session, sig, box, foreign: false };
      cx.notify();
    });
  },

  swapDraft(key, from = this.key) {
    // The reply box's draft kept for session `from` (default: the one shown), and `key`'s put in it.
    if (from) {
      const text = this.input.value(), attachments = this.attachments;
      if (text || attachments.length) this.drafts.set(from, { text, attachments });
      else this.drafts.delete(from);
    }
    const draft = key ? this.drafts.get(key) : null;
    this.input.set_value(draft?.text ?? "");
    this.attachments = draft?.attachments ?? [];
    this.mirror = null;
  },
};
