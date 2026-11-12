// A night sky: three layers of stars drifting sideways at their own pace (the far ones slowest), thicker along a
// faint band like the Milky Way, each twinkling on its own clock; now and then a shooting star. Stars near the
// pointer brighten; a click sends a shooting star from there.
import { Grid, strokeFor } from "../grid.js";

// Two tints, and brightness in six steps: stars of one look merge into one run across a row.
const TINTS = [[214, 224, 255], [255, 238, 214]];

export class SkyScene {
  constructor() {
    this.grid = new Grid();
    this.pointer = { x: 0, y: 0, active: false };
    this.time = 0; this.dim = 1;
    this.stars = [];
    this.meteors = [];
    this.nextMeteor = 2 + Math.random() * 4;
  }

  setDim(dim) { this.dim = dim; }

  resize(width, height, cw, ch) {
    const changed = this.grid.resize(width, height, cw, ch);
    this.W = width; this.H = height;
    if (changed || !this.stars.length) this.seed();
  }

  seed() {
    const { W, H } = this, n = Math.round((W * H) / 900);
    // The band: a slanted strip across the sky where stars crowd.
    const slope = 0.35, mid = H * 0.5;
    this.stars = [];
    while (this.stars.length < n) {
      const x = Math.random() * W, y = Math.random() * H;
      const off = Math.abs(y - (mid + (x - W / 2) * slope)) / (H * 0.18);
      if (Math.random() > 0.35 + 0.65 * Math.exp(-off * off)) continue;
      const layer = Math.random() < 0.6 ? 0 : Math.random() < 0.75 ? 1 : 2;
      this.stars.push({
        x, y, layer, mag: Math.pow(Math.random(), 2.2) * (0.6 + 0.2 * layer) + 0.15,
        freq: 0.6 + Math.random() * 2.4, phase: Math.random() * 6.3, tint: TINTS[(Math.random() * TINTS.length) | 0],
      });
    }
  }

  splash(x, y) { this.launch(x, y); }

  launch(x, y) {
    const a = (Math.random() < 0.5 ? 0.35 : Math.PI - 0.35) + (Math.random() - 0.5) * 0.4, v = 520 + Math.random() * 300;
    this.meteors.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.9 + Math.random() * 0.6, trail: [] });
  }

  frame(dt, pal) {
    this.time += dt;
    const { W, H } = this;
    for (const s of this.stars) { s.x -= (2 + s.layer * 4) * dt; if (s.x < 0) s.x += W; }
    this.nextMeteor -= dt;
    if (this.nextMeteor <= 0) { this.launch(Math.random() * W, Math.random() * H * 0.4); this.nextMeteor = 4 + Math.random() * 7; }
    for (const m of this.meteors) {
      m.trail.unshift([m.x, m.y]); if (m.trail.length > 9) m.trail.pop();
      m.x += m.vx * dt; m.y += m.vy * dt; m.life += dt;
    }
    this.meteors = this.meteors.filter(m => m.life < m.max);
    this.paint(pal);
  }

  paint(pal) {
    const g = this.grid, a = this.dim, t = this.time, p = this.pointer;
    g.clear();
    for (const s of this.stars) {
      const c = g.at(s.x, s.y);
      if (c < 0) continue;
      let b = s.mag * (0.55 + 0.45 * Math.sin(t * s.freq + s.phase));
      if (p.active) { const d = Math.hypot(s.x - p.x, s.y - p.y); if (d < 120) b += (1 - d / 120) * 0.5; }
      b = Math.round(Math.min(1, b) * 6) / 6;
      if (b <= 0) continue;
      const glyph = b > 0.8 ? "*" : b > 0.55 ? "+" : b > 0.3 ? "·" : ".";
      g.put(c, glyph, pal.mix(s.tint[0], s.tint[1], s.tint[2], b * a));
    }
    const ac = pal.accents[0];
    for (const m of this.meteors) {
      const fade = 1 - m.life / m.max, stroke = strokeFor(Math.atan2(m.vy, m.vx));
      m.trail.forEach(([x, y], k) => {
        const c = g.at(x, y);
        if (c >= 0) g.put(c, k < 3 ? stroke : "·", pal.mix(255, 236 - k * 8, 200 - k * 12, Math.max(0, (1 - k / 9) * fade) * a));
      });
      const c = g.at(m.x, m.y);
      if (c >= 0) g.put(c, "*", pal.mix(255, 250, 235, fade * a));
      if (c >= 0 && m.life < 0.12) g.put(c, "*", pal.mix(ac[0], ac[1], ac[2], a));
    }
  }
}
