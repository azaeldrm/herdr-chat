// Colours over the page's background, from the theme, each one a single shared string: every scene draws with these.

const quant = v => { const q = Math.round(v * 0.25) * 4; return q < 0 ? 0 : q > 252 ? 252 : q; };

const hex = c => {
  const m = /^#?([0-9a-f]{6})/i.exec(String(c ?? ""));
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Colours over the chat's background, from the theme, each one a single shared string. */
export class Palette {
  constructor(t = {}) {
    this.base = hex(t.background ?? "#080a0b");
    this.fish = hex(t.foreground ?? "#dededb");
    this.wake = hex(t.done ?? "#10a7a7");
    this.accents = [t.accent ?? "#e9aa35", t.done ?? "#10a7a7", "#d88179", "#8eafc2"].map(hex);
    this.cache = new Map();
  }

  /** rgb at opacity a over the background, rounded so near colours are the same string. */
  mix(r, g, b, a = 1) {
    const base = this.base;
    const cr = quant(base[0] + (r - base[0]) * a), cg = quant(base[1] + (g - base[1]) * a), cb = quant(base[2] + (b - base[2]) * a);
    const key = (cr << 16) | (cg << 8) | cb;
    let s = this.cache.get(key);
    if (!s) { s = "#" + key.toString(16).padStart(6, "0"); this.cache.set(key, s); }
    return s;
  }
}
