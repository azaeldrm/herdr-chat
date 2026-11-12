// Rain on glass: drops streak down the page at their own speeds, a bright head and a fading tail, and splash into a
// few specks where they land. Most are cool teal, a few catch the amber light. The pointer wipes a clear patch on the
// glass; a click sends a ripple out from it.
import { Grid } from "../grid.js";

const TAIL = ["|", "|", ":", ":", "'", "'", ".", "."];

export class RainScene {
  constructor() {
    this.grid = new Grid();
    this.pointer = { x: 0, y: 0, active: false };
    this.time = 0; this.dim = 1;
    this.drops = []; this.specks = []; this.ripples = [];
  }

  setDim(dim) { this.dim = dim; }

  resize(width, height, cw, ch) {
    this.grid.resize(width, height, cw, ch);
    this.W = width; this.H = height;
    this.target = Math.round(this.grid.cols * 0.45);
    while (this.drops.length < this.target) this.drops.push(this.drop(true));
  }

  drop(anywhere) {
    const { W, H } = this, ch = this.grid.ch;
    return {
      x: (Math.floor(Math.random() * this.grid.cols) + 0.5) * this.grid.cw,
      y: anywhere ? Math.random() * H : -Math.random() * H * 0.3,
      v: 160 + Math.random() * 360, len: 3 + ((Math.random() * 6) | 0),
      // Where it lands: most run to the bottom, some stop partway, beading on the glass.
      stop: Math.random() < 0.7 ? H - ch : H * (0.35 + Math.random() * 0.6),
      warm: Math.random() < 0.12,
    };
  }

  splash(x, y) { this.ripples.push({ x, y, r: 0 }); }

  frame(dt, pal) {
    this.time += dt;
    const ch = this.grid.ch;
    for (let k = 0; k < this.drops.length; k++) {
      const d = this.drops[k];
      d.y += d.v * dt;
      if (d.y >= d.stop) {
        for (let s = 0; s < 3; s++) this.specks.push({ x: d.x + (Math.random() - 0.5) * this.grid.cw * 5, y: d.stop - Math.random() * ch, life: 0, max: 0.25 + Math.random() * 0.35, warm: d.warm });
        this.drops[k] = this.drop(false);
      }
    }
    for (const s of this.specks) s.life += dt;
    this.specks = this.specks.filter(s => s.life < s.max);
    for (const r of this.ripples) r.r += 260 * dt;
    this.ripples = this.ripples.filter(r => r.r < 260);
    this.paint(pal);
  }

  wiped(x, y) {
    const p = this.pointer;
    return p.active && Math.hypot((x - p.x) * 0.8, y - p.y) < 70;
  }

  paint(pal) {
    const g = this.grid, a = this.dim, ch = g.ch;
    const cool = pal.wake, warm = pal.accents[0];
    g.clear();
    for (const d of this.drops) {
      const tone = d.warm ? warm : cool;
      for (let k = 0; k < d.len; k++) {
        const y = d.y - k * ch;
        if (y < 0 || this.wiped(d.x, y)) continue;
        const c = g.at(d.x, y);
        if (c >= 0) g.put(c, k === 0 ? "|" : TAIL[Math.min(TAIL.length - 1, k)], k === 0 ? pal.mix(235, 245, 245, 0.85 * a) : pal.mix(tone[0], tone[1], tone[2], (1 - k / d.len) * 0.8 * a));
      }
    }
    for (const s of this.specks) {
      if (this.wiped(s.x, s.y)) continue;
      const tone = s.warm ? warm : cool, f = 1 - s.life / s.max;
      g.put(g.at(s.x, s.y), f > 0.6 ? "o" : f > 0.3 ? "." : "'", pal.mix(tone[0], tone[1], tone[2], f * a));
    }
    for (const r of this.ripples) {
      const f = 1 - r.r / 260, steps = Math.max(12, Math.round(r.r / 6));
      for (let k = 0; k < steps; k++) {
        const t = (k / steps) * Math.PI * 2;
        g.put(g.at(r.x + Math.cos(t) * r.r, r.y + Math.sin(t) * r.r * 0.55), "o", pal.mix(cool[0], cool[1], cool[2], f * a));
      }
    }
  }
}
