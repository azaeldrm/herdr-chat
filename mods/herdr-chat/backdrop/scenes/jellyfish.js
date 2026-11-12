// Jellyfish: big translucent bells drawn as shaded tiles (cells with a background and a glyph), pulsing slowly and
// rising on each squeeze, tilting as they drift. From the middle of each bell hang frilly oral arms; from its rim,
// long thin tentacles that trail and curl behind it. Far ones are smaller and fainter. Plankton drift between them;
// the pointer pushes the plankton, and a click makes the nearest jellyfish pulse hard.
import { Grid } from "../grid.js";
import { clamp, hash3 } from "../vendor/ascii-sharks/math.js";

const HUES = [[86, 204, 184], [150, 126, 232], [96, 186, 228], [120, 214, 170]];
const TILES = "o%tS8#@X";
const TENTACLE_SEGMENTS = 22, ARM_SEGMENTS = 16;
// They glow: drawn this much brighter than the page's dim, so they stand out the way the sharks' bulk does.
const GLOW = 2.2;

export class JellyfishScene {
  constructor() {
    this.grid = new Grid();
    this.pointer = { x: 0, y: 0, active: false };
    this.time = 0; this.dim = 1;
    this.jellies = []; this.plankton = [];
  }

  setDim(dim) { this.dim = dim; }

  resize(width, height, cw, ch) {
    const changed = this.grid.resize(width, height, cw, ch);
    this.W = width; this.H = height;
    if (!changed && this.jellies.length) return;
    const n = Math.max(3, Math.min(5, Math.round(width / 300)));
    this.jellies = [];
    for (let k = 0; k < n; k++) this.jellies.push(this.jelly(((k + 0.3 + Math.random() * 0.4) / n) * width, height * (0.15 + Math.random() * 0.85), k));
    // Deeper ones first, so the near ones draw over them.
    this.jellies.sort((a, b) => a.depth - b.depth);
    this.plankton = [];
    for (let k = 0; k < Math.round((width * height) / 6000); k++) this.plankton.push({ x: Math.random() * width, y: Math.random() * height, vx: 0, vy: 0, b: 0.15 + Math.random() * 0.4 });
  }

  jelly(x, y, k) {
    const depth = k === 0 ? 1 : 0.45 + Math.random() * 0.55;
    const R = clamp(this.H * (0.13 + 0.07 * depth), 55, 150);
    const chain = (n, len) => { const pts = []; for (let s = 0; s < n; s++) pts.push([x, y + s * len]); return pts; };
    const tentacles = [], arms = [];
    for (let t = 0; t < 9; t++) tentacles.push({ at: (t / 8) * 1.8 - 0.9, pts: chain(TENTACLE_SEGMENTS, R * 0.16), phase: Math.random() * 6.3, len: R * (0.13 + Math.random() * 0.07) });
    for (let t = 0; t < 4; t++) arms.push({ at: (t / 3) * 0.7 - 0.35, pts: chain(ARM_SEGMENTS, R * 0.12), phase: Math.random() * 6.3 });
    return { id: k + 1, x, y, R, depth, phase: Math.random() * 6.3, rate: 0.28 + Math.random() * 0.14, vy: -6, vx: 0, tilt: 0,
      hue: HUES[(Math.random() * HUES.length) | 0], tentacles, arms, kick: 0 };
  }

  splash(x, y) {
    let best = null, bd = Infinity;
    for (const j of this.jellies) { const d = Math.hypot(j.x - x, j.y - y); if (d < bd) { bd = d; best = j; } }
    if (best) best.kick = 1;
  }

  /** A point on the bell, in its own frame (lx across, ly down from the rim's middle), turned into the page. */
  toPage(j, lx, ly) {
    const c = Math.cos(j.tilt), s = Math.sin(j.tilt);
    return [j.x + lx * c - ly * s, j.y + lx * s + ly * c];
  }

  frame(dt, pal) {
    this.time += dt;
    const { W, H } = this, p = this.pointer, t = this.time;
    for (const j of this.jellies) {
      j.phase += dt * j.rate * Math.PI * 2;
      // A squeeze pushes the bell up; between squeezes it sinks back a little.
      const squeeze = Math.max(0, Math.sin(j.phase)) + j.kick;
      j.kick = Math.max(0, j.kick - dt * 1.2);
      j.vy += (-squeeze * 34 * (0.6 + 0.4 * j.depth) - j.vy * 1.2 + 4) * dt;
      j.vx = Math.sin(t * 0.11 + j.id * 1.7) * 9;
      j.y += j.vy * dt; j.x += j.vx * dt;
      j.tilt += (clamp(j.vx / 40, -0.35, 0.35) - j.tilt) * Math.min(1, dt * 0.8);
      if (j.y < -j.R * 3.5) {
        j.y = H + j.R * 0.8; j.x = W * (0.1 + Math.random() * 0.8);
        for (const c of [...j.tentacles, ...j.arms]) for (const q of c.pts) { q[0] = j.x; q[1] = j.y; }
      }
      const squash = 1 - Math.max(0, Math.sin(j.phase)) * 0.16;
      // Each strand hangs from the rim (tentacles) or the middle (arms), every point following the one above it.
      const hang = (c, rootX, rootY, seg, sway) => {
        const pts = c.pts;
        pts[0][0] = rootX; pts[0][1] = rootY;
        for (let s = 1; s < pts.length; s++) {
          const wave = Math.sin(t * 1.3 + c.phase + s * 0.45) * sway * s;
          const tx = pts[s][0] + wave * dt - pts[s - 1][0], ty = pts[s][1] + 22 * dt - pts[s - 1][1];
          const d = Math.hypot(tx, ty) || 1;
          pts[s][0] = pts[s - 1][0] + (tx / d) * seg; pts[s][1] = pts[s - 1][1] + (ty / d) * seg;
        }
      };
      for (const c of j.tentacles) { const [rx, ry] = this.toPage(j, c.at * j.R * squash, j.R * 0.06); hang(c, rx, ry, c.len, 3.2); }
      for (const c of j.arms) { const [rx, ry] = this.toPage(j, c.at * j.R * 0.45, j.R * 0.05); hang(c, rx, ry, j.R * 0.12, 1.6); }
    }
    for (const q of this.plankton) {
      q.vx += (Math.random() - 0.5) * 16 * dt; q.vy += ((Math.random() - 0.5) * 16 - 1.5) * dt;
      if (p.active) { const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy); if (d < 90 && d > 1) { q.vx += (dx / d) * 160 * dt; q.vy += (dy / d) * 160 * dt; } }
      q.vx *= 1 - dt * 1.5; q.vy *= 1 - dt * 1.5;
      q.x = (q.x + q.vx * dt + W) % W; q.y = (q.y + q.vy * dt + H) % H;
    }
    this.paint(pal);
  }

  paint(pal) {
    const g = this.grid, a = this.dim, { cw, ch, cols, rows } = g, t = this.time;
    g.clear();
    for (const q of this.plankton) g.put(g.at(q.x, q.y), "·", pal.mix(150, 200, 220, q.b * a));
    for (const j of this.jellies) {
      const [hr, hg, hb] = j.hue, da = Math.min(1, a * GLOW) * (0.35 + 0.65 * j.depth);
      // Tentacles: thin, fading toward their ends.
      for (const c of j.tentacles) c.pts.forEach(([x, y], s) => {
        if (s === 0) return;
        const f = 1 - s / TENTACLE_SEGMENTS, i = g.at(x, y);
        if (i >= 0 && g.bg[i] === null) g.put(i, f > 0.6 ? ":" : f > 0.3 ? "'" : ".", pal.mix(hr, hg, hb, (0.25 + 0.6 * f) * da));
      });
      // Oral arms: frilly ribbons two cells wide, tiled.
      for (const c of j.arms) c.pts.forEach(([x, y], s) => {
        const f = 1 - s / ARM_SEGMENTS, frill = Math.sin(t * 2 + c.phase + s * 1.3) * cw * 0.8;
        for (const off of [-cw * 0.5 + frill, cw * 0.5 + frill]) {
          const i = g.at(x + off, y);
          if (i < 0) continue;
          const key = (hash3(s, Math.round(off / cw), j.id * 13 + c.at * 7) * 4294967295) >>> 0;
          g.bg[i] = pal.mix(hr * 0.8, hg * 0.8, hb * 0.8, (0.3 + 0.5 * f) * da);
          g.put(i, TILES[key % TILES.length], pal.mix(hr * 0.22, hg * 0.22, hb * 0.22, da));
        }
      });
      // The bell: a dome over a scalloped rim, squashing wide and low on each squeeze. Lit from above, densest at the
      // rim, with faint radial canals; each tile's glyph rides with the bell.
      const sq = Math.max(0, Math.sin(j.phase)) * 0.16, rx = j.R * 0.82 * (1 + sq * 0.5), ry = j.R * 0.86 * (1 - sq), rim = j.R * 0.1;
      const reach = Math.hypot(rx, ry) + Math.hypot(cw, ch);
      const c0 = Math.max(0, Math.floor((j.x - reach) / cw)), c1 = Math.min(cols - 1, Math.floor((j.x + reach) / cw));
      const r0 = Math.max(0, Math.floor((j.y - reach) / ch)), r1 = Math.min(rows - 1, Math.floor((j.y + reach) / ch));
      const cs = Math.cos(-j.tilt), sn = Math.sin(-j.tilt);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * cw - j.x, dy = (r + 0.5) * ch - j.y;
        const lx = dx * cs - dy * sn, ly = dx * sn + dy * cs;
        const ex = lx / rx;
        if (Math.abs(ex) > 1) continue;
        let inside, depthIn;
        if (ly < 0) { const e = ex * ex + (ly / ry) * (ly / ry); inside = e <= 1; depthIn = 1 - e; }
        else { const scallop = rim * (0.55 + 0.45 * Math.cos(ex * Math.PI * 7)); inside = ly <= scallop * (1 - ex * ex * 0.3); depthIn = 0.15; }
        if (!inside) continue;
        const i = r * cols + c;
        const top = clamp(-ly / ry, 0, 1), atRim = ly > -rim * 1.5 ? 1 : 0;
        const canal = Math.abs(Math.sin(Math.atan2(lx, -ly + ry * 0.2) * 8)) < 0.16 ? 0.18 : 0;
        const shade = Math.round(clamp(0.32 + 0.38 * top + 0.25 * atRim + canal - 0.25 * depthIn * (1 - top), 0, 1) * 6) / 6;
        const key = (hash3(Math.round(lx / cw), Math.round(ly / ch), j.id) * 4294967295) >>> 0;
        g.bg[i] = pal.mix(hr * (0.45 + 0.55 * shade), hg * (0.45 + 0.55 * shade), hb * (0.45 + 0.55 * shade), (0.45 + 0.5 * shade) * da);
        const roll = hash3(key, Math.floor(t * 1.5 + (key % 977) / 80), 5);
        g.glyph[i] = TILES[key % TILES.length];
        g.fg[i] = roll < 0.05 ? pal.mix(240, 252, 252, da) : pal.mix(hr * 0.18, hg * 0.18, hb * 0.18, da);
      }
    }
  }
}
