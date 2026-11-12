// A page of character cells for a scene to draw on: per cell a glyph (" " for none), its colour and its background
// (null for the page's own). runs.js turns it into rows of text.

export class Grid {
  constructor() {
    this.cols = 0; this.rows = 0; this.cw = 8; this.ch = 16; this.width = 0; this.height = 0;
    this.glyph = []; this.fg = []; this.bg = [];
  }

  /** Lays the grid over width × height px in cells of cw × ch px. Whether the number of cells changed. */
  resize(width, height, cw, ch) {
    this.width = width; this.height = height; this.cw = cw; this.ch = ch;
    const cols = Math.max(1, Math.ceil(width / cw)), rows = Math.max(1, Math.ceil(height / ch));
    if (cols === this.cols && rows === this.rows) return false;
    this.cols = cols; this.rows = rows;
    const n = cols * rows;
    this.glyph = new Array(n).fill(" "); this.fg = new Array(n).fill(null); this.bg = new Array(n).fill(null);
    return true;
  }

  clear() { this.glyph.fill(" "); this.fg.fill(null); this.bg.fill(null); }

  /** The cell under (x, y) px, or -1 off the page. */
  at(x, y) {
    const c = Math.floor(x / this.cw), r = Math.floor(y / this.ch);
    return c < 0 || r < 0 || c >= this.cols || r >= this.rows ? -1 : r * this.cols + c;
  }

  put(i, glyph, color) { if (i >= 0) { this.glyph[i] = glyph; this.fg[i] = color; } }
}

/** The glyph for a heading (radians, y down): a short stroke along it. */
export function strokeFor(angle) {
  const a = ((angle % Math.PI) + Math.PI) % Math.PI;
  return a < Math.PI / 8 || a >= (7 * Math.PI) / 8 ? "-" : a < (3 * Math.PI) / 8 ? "\\" : a < (5 * Math.PI) / 8 ? "|" : "/";
}
