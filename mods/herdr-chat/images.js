import { div, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { appHome, exec, hc } from "herdr";
import { onWindows, modFile, removeFiles, pruneOld } from "./platform.js";
import { sessionOf } from "./common.js";
import { icon } from "./ui.js";

export const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;
export const ATTACH_DIR = "cache/herdr-chat";
export function attachDir() { return onWindows() ? `${appHome()}\\cache\\herdr-chat` : `${appHome()}/${ATTACH_DIR}`; }
export function attachName(source) {
  // A unique name for the preview copy, without its extension (the prepare script picks it).
  const base = source.split(/[\\/]/).pop().replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "-").slice(-40) || "image";
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}-${base}`;
}

export const ImageMethods = {
  async placeImages(t, attached) {
    // `hc put` each image beside the agent's terminal (this computer or another) and return where they landed.
    const placed = [];
    const where = sessionOf(t);
    for (const a of attached) {
      if (a.placed?.[where]) { placed.push(a.placed[where]); continue; }
      const r = await hc(["put", "--json", t.address, a.file]);
      let path = null;
      try { path = r.code === 0 ? JSON.parse(r.stdout).path : null; } catch {}
      if (!path) throw new Error(`Couldn't send ${a.name}${t.machine ? ` to ${t.machine}` : ""}: ${(r.stderr || r.stdout || "hc put failed").trim()}`);
      (a.placed ??= {})[where] = path;
      placed.push(path);
    }
    return placed;
  },

  async prepare(args, label) {
    // Runs a prepare script; resolves with the preview copy's path, or null with the reason in the note.
    const r = onWindows()
      ? await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", modFile("prepare-image.ps1"), ...args.windows]).catch(e => ({ code: 1, stderr: String(e) }))
      : await exec("sh", args.unix).catch(e => ({ code: 1, stderr: String(e) }));
    const file = (r.stdout ?? "").trim().split(/\r?\n/).pop();
    if ((r.code === 0 || r.code === 5) && file) {
      if (r.code === 5) this.note = `${label} is over 256 KB and nothing here can shrink it (install ImageMagick), so Claude Code may not attach it.`;
      return file;
    }
    if (r.code === 3) return null;
    this.note = r.code === 4
      ? "Pasting images needs wl-paste (Wayland), xclip (X11) or pngpaste (macOS). Drop the file instead."
      : `Couldn't attach ${label}: ${(r.stderr || "it couldn't be read").trim()}`;
    return null;
  },

  attach(file, name, cx, owner = this.key) {
    // Adds an image to the draft of `owner`, the session it was added in, even if another one shows now.
    const a = { name, file, rel: `${ATTACH_DIR}/${file.split(/[\\/]/).pop()}` };
    if (owner === this.key) this.attachments.push(a);
    else {
      const d = this.drafts.get(owner) ?? { text: "", attachments: [] };
      this.drafts.set(owner, { ...d, attachments: [...d.attachments, a] });
    }
    cx.notify();
  },

  forget(files) {
    // Deletes preview copies: after a send, or when one is removed from the box.
    removeFiles(files);
  },

  pruneCache() {
    // Preview copies left by a copy that closed before sending them: anything older than a day.
    pruneOld(attachDir());
  },

  dropFiles(paths, cx) {
    // Dropped files: images get a preview copy (shrunk when big) and are attached; anything else is ignored.
    const images = paths.filter(p => IMAGE_FILE.test(p));
    if (!images.length) { this.note = "Only images can be attached (png, jpg, gif, webp)."; cx.notify(); return; }
    const owner = this.key;
    cx.spawn(async cx => {
      for (const source of images) {
        const label = source.split(/[\\/]/).pop(), name = attachName(source);
        const file = await this.prepare({
          unix: [modFile("prepare-image.sh"), source, attachDir(), name],
          windows: ["-Source", source, "-Folder", attachDir(), "-Name", name],
        }, label);
        if (file) this.attach(file, label, cx, owner);
        else cx.notify();
      }
    });
  },

  pasteImage(cx) {
    // Ctrl+V with an image (and no text) on the clipboard: attached like a dropped file.
    const owner = this.key;
    cx.spawn(async cx => {
      const name = attachName("pasted");
      const file = await this.prepare({
        unix: [modFile("prepare-image.sh"), "--clipboard", attachDir(), name],
        windows: ["-Clipboard", "-Folder", attachDir(), "-Name", name],
      }, "the pasted image");
      if (file) this.attach(file, "Pasted image", cx, owner);
      else cx.notify();
    });
  },

  attachmentStrip(t) {
    return h_flex().w_full().flex_wrap().gap(8).pt(2).pb(4)
      .children(this.attachments.map((a, i) => div().id(`attachment-${i}`).relative().size(64).flex_none().rounded(10).overflow_hidden()
        .border_1().border_color(t.border).bg(t.raised)
        .tooltip(a.name)
        .child(image(a.rel).size_full())
        .child(div().id(`attachment-remove-${i}`).absolute().top(3).right(3).size(18).flex().items_center().justify_center()
          .rounded(9).bg(t.background).border_1().border_color(t.border).text_color(t.muted).cursor_pointer()
          .hover(s => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.forget(this.attachments.splice(i, 1).map(x => x.file)); cx.notify(); })
          .child(icon("close", 10, t.muted)))));
  },
};
