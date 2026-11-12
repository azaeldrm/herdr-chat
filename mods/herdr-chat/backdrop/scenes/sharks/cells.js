// The sharks scene as a grid of character cells: what each cell shows (a glyph, its colour, a background) for one frame.
// A port of ascii-sharks' canvas renderer (renderer.ts, MIT, see ../../vendor/ascii-sharks/LICENSE) to cells a mod can draw
// as text: the same wake field, fish and sharks (each cell tested once against the shark's shape, its edge shaded by
// how far inside it is), with every colour quantized so neighbouring cells share one and a row draws as a few runs.
import { clamp, hash3, smoothstep } from "../../vendor/ascii-sharks/math.js";
import { SHARK_NODES } from "../../vendor/ascii-sharks/world.js";
import { SHAPES, KINDS } from "./shapes.js";

const SKIN_RAMP = ":;t%SX8#@";
const FIN_GLYPHS = "%;tS:";
const RIDGE_GLYPHS = "@8%";
const MARK_GLYPHS = "#%@";
const EDGE_HEAVY = ":;";
const EDGE_LIGHT = ".',`";

const FLAG_BODY = 1, FLAG_EDGE = 2, FLAG_FIN = 3, FLAG_RIDGE = 4, FLAG_EYE = 5, FLAG_MARK = 6;
const FISH_ALPHAS = [0.28, 0.42, 0.58, 0.74, 0.9];
// Steps a shade is rounded to, so a shark's flank is a few bands of one colour rather than a new colour per cell.
const SHADE_STEPS = 7;

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

export class SharkCells {
  constructor() {
    this.cols = 0; this.rows = 0; this.cw = 8; this.ch = 16; this.width = 0; this.height = 0;
    this.spine = new Float32Array(SHARK_NODES * 2);
    this.arc = new Float32Array(SHARK_NODES);
    // Per spine segment: its vector, length and 1 / length², for the shark being drawn.
    this.segX = new Float64Array(SHARK_NODES - 1);
    this.segY = new Float64Array(SHARK_NODES - 1);
    this.segLen = new Float64Array(SHARK_NODES - 1);
    this.segInv2 = new Float64Array(SHARK_NODES - 1);
    this.arcTotal = 1;
    this.shape = SHAPES.classic;
    this.sharkId = 0;
    this.finTipLeft = 0; this.finTipRight = 0;
    this.hitFlag = 0; this.hitShade = 0; this.hitS = 0; this.hitV = 0; this.hitDist = 0;
    this.frameId = 0;
    // How bright the whole scene is, 0 to 1: it sits dimmed behind a page.
    this.dim = 1;
    this.alloc(0);
  }

  alloc(n) {
    this.energy = new Float32Array(n);
    this.energyTmp = new Float32Array(n);
    this.heat = new Float32Array(n);
    this.sharkFlag = new Uint8Array(n);
    this.sharkShade = new Float32Array(n);
    this.sharkKey = new Uint32Array(n);
    this.sharkDepth = new Float32Array(n);
    this.sharkKind = new Uint8Array(n);
    this.fishStamp = new Uint32Array(n);
    this.fishLevel = new Uint8Array(n);
    this.fade = new Float32Array(n).fill(1);
    this.candidate = new Uint32Array(n);
    this.candidateSeg = new Uint8Array(n);
    this.candidateDist = new Float64Array(n);
    this.candidateU = new Float64Array(n);
    this.candidateCross = new Float64Array(n);
    this.candidateList = new Int32Array(n);
    this.candidateFrame = 0;
    // The frame: per cell a glyph (" " for none), its colour and its background (null for the page's own).
    this.glyph = new Array(n).fill(" ");
    this.fg = new Array(n).fill(null);
    this.bg = new Array(n).fill(null);
  }

  /** Lays the grid over width × height px in cells of cw × ch px; keeps the fields when the grid is the same. */
  resize(width, height, cw, ch) {
    this.width = width; this.height = height; this.cw = cw; this.ch = ch;
    const cols = Math.max(1, Math.ceil(width / cw)), rows = Math.max(1, Math.ceil(height / ch));
    if (cols !== this.cols || rows !== this.rows) { this.cols = cols; this.rows = rows; this.alloc(cols * rows); }
    this.setDim(this.dim);
  }

  /** Dims the whole scene evenly to `dim` (0 to 1), so it sits darker behind the page. */
  setDim(dim) {
    this.dim = dim;
    this.fade.fill(Math.round(dim * 12) / 12);
  }

  /** Draws world into glyph / fg / bg. dt: seconds since the last frame (for the wake's ripple and fade). */
  frame(world, dt, pal) {
    if (!this.cols) return;
    const t = world.time;
    this.consumeEvents(world);
    this.rasterizeSharks(world.sharks, t);
    this.depositWake(world);
    this.diffuse(dt);
    this.markFish(world);
    this.paint(t, pal);
  }

  cellIndex(x, y) {
    const c = Math.floor(x / this.cw), r = Math.floor(y / this.ch);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  stamp(field, x, y, radius, amount) {
    const c0 = Math.floor(x / this.cw), r0 = Math.floor(y / this.ch);
    for (let r = r0 - radius; r <= r0 + radius; r++) for (let c = c0 - radius; c <= c0 + radius; c++) {
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
      const d = Math.hypot(c - c0, (r - r0) * 1.4);
      if (d > radius + 0.5) continue;
      const i = r * this.cols + c;
      field[i] = Math.min(1.6, field[i] + amount * (1 - d / (radius + 1)));
    }
  }

  consumeEvents(world) {
    for (const e of world.events) {
      if (e.kind === "eat") { this.stamp(this.heat, e.x, e.y, 2, 1); this.stamp(this.energy, e.x, e.y, 3, 0.9); }
      else this.stamp(this.energy, e.x, e.y, 6, 1.4);
    }
    world.events.length = 0;
  }

  depositWake(world) {
    const { energy } = this;
    for (const f of world.fish) {
      if (!f.alive) continue;
      const i = this.cellIndex(f.x, f.y);
      if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.012 + f.alarm * 0.03);
    }
    for (const sh of world.sharks) {
      // The tail sweeps the most water.
      for (let k = SHARK_NODES - 6; k < SHARK_NODES; k++) {
        const i = this.cellIndex(sh.nodes[k * 2], sh.nodes[k * 2 + 1]);
        if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.05 + sh.speed * 0.0012);
      }
    }
    if (world.pointer.active) this.stamp(energy, world.pointer.x, world.pointer.y, 1, 0.08);
  }

  /** Blur and decay, so wakes spread like ripples and fade. */
  diffuse(dt) {
    const { cols, rows, energy, energyTmp: tmp, heat } = this;
    const decay = Math.exp(-dt * 1.5);
    // The edges repeat their own value past the border; the inside, most of the grid, needs no checks for that.
    const edge = i => {
      const c = i % cols, r = (i / cols) | 0;
      const l = c > 0 ? energy[i - 1] : energy[i];
      const rt = c < cols - 1 ? energy[i + 1] : energy[i];
      const u = r > 0 ? energy[i - cols] : energy[i];
      const d = r < rows - 1 ? energy[i + cols] : energy[i];
      tmp[i] = (energy[i] * 4 + l + rt + u + d) * 0.125 * decay;
    };
    for (let c = 0; c < cols; c++) { edge(c); if (rows > 1) edge((rows - 1) * cols + c); }
    for (let r = 1; r < rows - 1; r++) {
      edge(r * cols);
      if (cols > 1) edge(r * cols + cols - 1);
      for (let i = r * cols + 1, end = r * cols + cols - 1; i < end; i++)
        tmp[i] = (energy[i] * 4 + energy[i - 1] + energy[i + 1] + energy[i - cols] + energy[i + cols]) * 0.125 * decay;
    }
    this.energy = tmp; this.energyTmp = energy;
    const heatDecay = Math.exp(-dt * 2.2);
    for (let i = 0; i < heat.length; i++) heat[i] *= heatDecay;
  }

  /**
   * Whether a point is on the current shark, from its nearest point on the spine (found while marking candidates):
   * best its squared distance, bestK its segment, bestU how far along it (0 to 1), bestCross which side it's on. Body
   * coordinates s (along) and v (across), and what the point is (body, fin, eye…), go to hit*.
   */
  classify(best, bestK, bestU, bestCross, L) {
    const { arc, segX, segY, segLen } = this;
    const bestSign = bestCross >= 0 ? 1 : -1, len = segLen[bestK] || 1;
    const bestS = (arc[bestK] + bestU * len) / this.arcTotal;
    const bestNx = (-segY[bestK] / len) * bestSign, bestNy = (segX[bestK] / len) * bestSign;
    const a = Math.sqrt(best), s = bestS, u = s * L, shape = this.shape;
    const w = shape.halfWidth(s) * L;
    this.hitDist = a; this.hitS = s; this.hitV = a * bestSign; this.hitW = w; this.hitNx = bestNx; this.hitNy = bestNy;
    this.hitHead = false;

    const head = shape.head;
    if (head && u < L * (head.sweep + head.depth + head.notch)) {
      // Cephalofoil: a wide wing across the snout, tips swept back toward the eyes.
      const span = L * head.span, r = a / span;
      const front = L * head.sweep * r * r + L * head.notch * Math.max(0, 1 - r / 0.14);
      const depth = L * head.depth * (1 - 0.2 * r * r * r * r);
      if (r <= 1 && u >= front && u <= front + depth) {
        this.hitHead = true;
        this.hitFlag = r > 0.84 ? FLAG_EYE : FLAG_BODY;
        this.hitShade = r > 0.84 ? 0 : 0.62 - 0.2 * r + (u < front + L * 0.012 ? 0.1 : 0);
        return true;
      }
    }

    if (a <= w) {
      const across = a / (w || 1);
      // A rounded back lit from the top left; the flanks fall into shadow.
      const facing = (bestNx * -0.6 + bestNy * -0.8) * across;
      let shade = 0.58 - across * across * 0.42 + facing * 0.26;
      let flag = FLAG_BODY;
      if (s > shape.dorsal[0] && s < shape.dorsal[1] && across < 0.3) { flag = FLAG_RIDGE; shade = 1; }
      else if (s > shape.secondDorsal[0] && s < shape.secondDorsal[1] && across < 0.4) shade = Math.max(shade, 0.82);
      else if (shape.eye && s > shape.eye[0] && s < shape.eye[1] && across > 0.6) { flag = FLAG_EYE; shade = 0; }
      else if (s > shape.gills[0] && s < shape.gills[1] && across > 0.58) {
        if (Math.floor(((s - shape.gills[0]) / (shape.gills[1] - shape.gills[0])) * 5) % 2 === 0) shade *= 0.45;
      }
      else if (s < 0.05) shade = Math.max(shade, 0.7);
      else if (shape === SHAPES.zebra && s > 0.08 && s < 0.55 && (across < 0.1 || Math.abs(across - 0.6) < 0.08)) shade = Math.max(shade, 0.8);
      else if (this.marked(s, a * bestSign, L, across)) flag = FLAG_MARK;
      this.hitFlag = flag; this.hitShade = shade;
      return true;
    }

    // Fins, each tested only where it can be (the triangle's own span along the body).
    const tip = bestSign > 0 ? this.finTipRight : this.finTipLeft;
    const pec = shape.pectoral, p0 = pec[0], p1 = pec[1], p2 = pec[2];
    if (s >= p0 && s <= p2 && a <= tip && inTriangle(u, a, L * p0, 0, L * p1, 0, L * p2, tip)
      && !(shape.falcate && inTriangle(u, a, L * p1, 0, L * (p1 + (p2 - p1) * 0.33), tip * 0.55, L * p2, tip))) {
      this.hitFlag = this.marked(s, a * bestSign, L, 0) ? FLAG_MARK : FLAG_FIN;
      this.hitShade = 0.38 + 0.22 * (1 - clamp(a / tip, 0, 1));
      return true;
    }
    const pel = shape.pelvic;
    if ((s >= pel[0] && s <= pel[2] && inTriangle(u, a, L * pel[0], 0, L * pel[1], 0, L * pel[2], L * pel[3]))
      || (shape.caudal > 0 && s >= 0.86 && inTriangle(u, a, L * 0.86, 0, L * 0.95, 0, L, L * shape.caudal))) {
      this.hitFlag = FLAG_FIN; this.hitShade = 0.36;
      return true;
    }
    return false;
  }

  /** How far from the spine the current shark reaches anywhere between s0 and s1 (s0 ≤ s1), in px. */
  extent(s0, s1, L) {
    const shape = this.shape;
    const over = (a, b) => s0 <= b && s1 >= a;
    let e = Math.max(shape.halfWidth(s0), shape.halfWidth(s1), shape.halfWidth((s0 + s1) / 2)) * L;
    if (over(shape.pectoral[0], shape.pectoral[2])) e = Math.max(e, this.finTipLeft, this.finTipRight);
    if (over(shape.pelvic[0], shape.pelvic[2])) e = Math.max(e, L * shape.pelvic[3]);
    if (shape.caudal > 0 && over(0.86, 1)) e = Math.max(e, L * shape.caudal);
    if (shape.head && s0 < shape.head.sweep + shape.head.depth + shape.head.notch) e = Math.max(e, L * shape.head.span);
    return e;
  }

  /** Dark skin markings: a tiger's bars, a zebra shark's spots. */
  marked(s, v, L, across) {
    if (this.shape === SHAPES.tiger) {
      if (s < 0.2 || s > 0.9 || across > 0.85) return false;
      const wobble = 0.35 * Math.sin((v / L) * 25 + s * 5);
      const bar = Math.sin(s * Math.PI * 2 * 9 + wobble);
      return bar > 0.65 - 0.5 * smoothstep(0.2, 0.42, s) + 0.4 * smoothstep(0.8, 0.9, s);
    }
    if (this.shape === SHAPES.zebra) {
      if (s < 0.07) return false;
      const gu = (s * L) / (L * 0.06), gv = v / (L * 0.045);
      const cu = Math.floor(gu), cv = Math.floor(gv);
      const jx = hash3(cu, cv, this.sharkId) * 0.5 + 0.25, jy = hash3(cu, cv, this.sharkId + 11) * 0.5 + 0.25;
      return (gu - cu - jx) ** 2 + (gv - cv - jy) ** 2 < 0.08;
    }
    return false;
  }

  /** An undulating spine from the sim's, then every cell near it sampled against the shape. */
  rasterizeSharks(sharks, t) {
    const { sharkFlag, sharkShade, sharkKey, sharkDepth, sharkKind, spine, arc, cw, ch, cols, rows } = this;
    sharkFlag.fill(0);
    for (const sh of sharks) {
      const L = sh.length, N = SHARK_NODES, n = sh.nodes;
      const swim = clamp(sh.speed / 60, 0.4, 1.4);
      this.shape = SHAPES[sh.kind] ?? SHAPES.classic;
      this.sharkId = sh.id;
      const kindIndex = Math.max(0, KINDS.indexOf(sh.kind));
      // A travelling body wave, growing toward the tail.
      for (let k = 0; k < N; k++) {
        const s = k / (N - 1), a = Math.max(0, k - 1), b = Math.min(N - 1, k + 1);
        let tx = n[a * 2] - n[b * 2], ty = n[a * 2 + 1] - n[b * 2 + 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        const amp = L * 0.05 * (0.1 + 0.9 * Math.pow(s, 1.8)) * swim;
        const off = amp * Math.sin(sh.phase - s * 5.2);
        spine[k * 2] = n[k * 2] - ty * off;
        spine[k * 2 + 1] = n[k * 2 + 1] + tx * off;
      }
      arc[0] = 0;
      for (let k = 0; k < N - 1; k++) {
        const sx = spine[k * 2 + 2] - spine[k * 2], sy = spine[k * 2 + 3] - spine[k * 2 + 1];
        const len2 = sx * sx + sy * sy || 1;
        this.segX[k] = sx; this.segY[k] = sy; this.segLen[k] = Math.sqrt(len2); this.segInv2[k] = 1 / len2;
        arc[k + 1] = arc[k] + this.segLen[k];
      }
      this.arcTotal = arc[N - 1] || 1;
      // Banking into a turn: the inside fin foreshortens, the outside one spreads.
      const bank = clamp(sh.turn * 0.45, -0.35, 0.35);
      const flex = 1 + 0.06 * Math.sin(sh.phase * 0.5);
      const reachFin = this.shape.pectoral[3];
      this.finTipRight = L * reachFin * flex * (1 - bank);
      this.finTipLeft = L * reachFin * flex * (1 + bank);

      // Candidate cells: each spine segment marks the cell centres within its own reach of it (the body's width there,
      // or a fin's or the cephalofoil's), and each cell keeps the nearest point on the spine among the segments that
      // reach it. A cell on the shark is within reach of its nearest segment, so that's the true nearest point, found
      // once here; herdr's engine is far slower than a browser's, and the shape test below needs no search of its own.
      const diag = Math.hypot(cw, ch) / 2;
      const stamp = ++this.candidateFrame;
      const { candidate, candidateSeg, candidateDist, candidateU, candidateCross, segX, segY, segInv2 } = this;
      let count = 0;
      for (let k = 0; k < N - 1; k++) {
        const ax = spine[k * 2], ay = spine[k * 2 + 1], bx = spine[k * 2 + 2], by = spine[k * 2 + 3];
        const sx = segX[k], sy = segY[k], inv2 = segInv2[k];
        const e = this.extent(arc[k] / this.arcTotal, arc[k + 1] / this.arcTotal, L) + diag, e2 = e * e;
        const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - e) / cw)), c1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx) + e) / cw));
        const r0 = Math.max(0, Math.floor((Math.min(ay, by) - e) / ch)), r1 = Math.min(rows - 1, Math.floor((Math.max(ay, by) + e) / ch));
        for (let r = r0; r <= r1; r++) {
          const dy = (r + 0.5) * ch - ay;
          for (let c = c0; c <= c1; c++) {
            const dx = (c + 0.5) * cw - ax;
            let u = (dx * sx + dy * sy) * inv2;
            if (u < 0) u = 0; else if (u > 1) u = 1;
            const ex = dx - sx * u, ey = dy - sy * u;
            const d2 = ex * ex + ey * ey;
            if (d2 > e2) continue;
            const i = r * cols + c;
            if (candidate[i] !== stamp) { candidate[i] = stamp; this.candidateList[count++] = i; }
            else if (d2 >= candidateDist[i]) continue;
            candidateSeg[i] = k; candidateDist[i] = d2; candidateU[i] = u; candidateCross[i] = sx * dy - sy * dx;
          }
        }
      }

      for (let j = 0; j < count; j++) {
        const i = this.candidateList[j];
        const centerHit = this.classify(candidateDist[i], candidateSeg[i], candidateU[i], candidateCross[i], L);
        const flag = this.hitFlag, shade = this.hitShade, s = this.hitS, v = this.hitV;
        // How much of the cell the body covers, from how far its centre is inside the outline (the original
        // supersampled every edge cell, too slow here): the cell's own depth across the outline is its width and
        // height weighed by the body's normal there. Fins and the cephalofoil count by their centre alone.
        let coverage = centerHit ? 1 : 0;
        const onBody = !centerHit || (flag !== FLAG_FIN && !this.hitHead);
        if (onBody) {
          const depth = Math.abs(this.hitNx) * cw + Math.abs(this.hitNy) * ch;
          const body = clamp(0.5 + (this.hitW - this.hitDist) / depth, 0, 1);
          coverage = centerHit ? Math.max(body, 0.6) : body;
        }
        if (coverage < 0.15) continue;
        // Keyed to the body, so each glyph rides along with the skin.
        sharkKey[i] = (hash3(Math.round(s * 52), Math.round(v / (cw * 0.9)), sh.id) * 4294967295) >>> 0;
        sharkDepth[i] = sh.depth;
        sharkKind[i] = kindIndex;
        if (centerHit && coverage >= 0.6) { sharkFlag[i] = flag; sharkShade[i] = clamp(shade, 0, 1); }
        else { sharkFlag[i] = FLAG_EDGE; sharkShade[i] = coverage; }
      }
    }
  }

  /** Each fish in its own cell, nearer fish first; brighter when near, turning hard or panicking. */
  markFish(world) {
    const { fishStamp, fishLevel, sharkFlag } = this;
    const frame = ++this.frameId;
    for (let pass = 0; pass < 2; pass++) for (const f of world.fish) {
      if (!f.alive || (f.depth > 0.78 ? 0 : 1) !== pass) continue;
      const i = this.cellIndex(f.x, f.y);
      if (i < 0 || fishStamp[i] === frame || sharkFlag[i]) continue;
      fishStamp[i] = frame;
      const glint = clamp(Math.abs(f.turn) / 3.5, 0, 1);
      const v = 0.3 + (0.4 * (f.depth - 0.55)) / 0.45 + 0.3 * Math.max(glint, f.alarm);
      fishLevel[i] = clamp(Math.floor(v * FISH_ALPHAS.length), 0, FISH_ALPHAS.length - 1);
    }
  }

  paint(t, pal) {
    const { cols, rows, glyph, fg, bg, energy, heat, sharkFlag, sharkShade, sharkKey, sharkDepth, sharkKind, fishStamp, fishLevel, fade, frameId } = this;
    const n = cols * rows;
    const step = v => Math.round(v * SHADE_STEPS) / SHADE_STEPS;
    for (let i = 0; i < n; i++) {
      const a = fade[i];
      const flag = sharkFlag[i];
      glyph[i] = " "; fg[i] = null; bg[i] = null;
      if (flag) {
        const key = sharkKey[i], shade = step(sharkShade[i]);
        const dim = 0.7 + 0.3 * sharkDepth[i];
        const tint = SHAPES[KINDS[sharkKind[i]]].tint, tr = tint[0], tg = tint[1], tb = tint[2];
        // Colours re-roll on a staggered clock, so the hide shimmers.
        const roll = hash3(key, Math.floor(t * 2.4 + (key % 997) / 97), 7);
        const accent = pal.accents[key % pal.accents.length];
        if (flag === FLAG_EDGE) {
          const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
          const g = (70 + shade * 80) * dim;
          glyph[i] = set[(key >>> 8) % set.length];
          fg[i] = roll < 0.07 ? pal.mix(accent[0], accent[1], accent[2], a) : pal.mix(g * tr, g * tg, Math.min(255, g * tb + 6), a);
          continue;
        }
        let level, g;
        if (flag === FLAG_RIDGE) { level = 226; g = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length]; }
        else if (flag === FLAG_EYE) { level = 12; g = "o"; }
        else if (flag === FLAG_MARK) { level = 24 + shade * 22; g = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length]; }
        else if (flag === FLAG_FIN) { level = 40 + shade * 120; g = FIN_GLYPHS[(key >>> 8) % FIN_GLYPHS.length]; }
        else {
          level = 46 + shade * 160;
          const jitter = ((key >>> 4) % 3) - 1;
          g = SKIN_RAMP[clamp(Math.floor((1 - shade) * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
        }
        level *= dim;
        bg[i] = pal.mix(Math.min(255, level * tr), Math.min(255, level * tg), Math.min(255, level * tb + 4), a);
        glyph[i] = g;
        if (flag === FLAG_EYE) fg[i] = pal.mix(0x9a, 0xa0, 0xad, a);
        else if (flag === FLAG_MARK) fg[i] = pal.mix(70 * tr, 70 * tg, 70 * tb, a);
        else if (roll < 0.09) fg[i] = pal.mix(accent[0], accent[1], accent[2], a);
        else if (roll < 0.13) fg[i] = pal.mix(255, 255, 255, a);
        else fg[i] = shade > 0.55 ? pal.mix(0x0e, 0x0f, 0x13, a) : pal.mix(0x1b, 0x1d, 0x24, a);
        continue;
      }
      if (fishStamp[i] === frameId) {
        glyph[i] = "-";
        fg[i] = pal.mix(pal.fish[0], pal.fish[1], pal.fish[2], FISH_ALPHAS[fishLevel[i]] * a);
        continue;
      }
      const h = heat[i];
      if (h >= 0.08) {
        glyph[i] = h > 0.6 ? "*" : "·";
        fg[i] = h > 0.5 ? pal.mix(255, 120, 60, Math.min(1, h) * a) : pal.mix(220, 40, 40, Math.min(1, h * 1.6) * a);
        continue;
      }
      const e = energy[i];
      if (e > 0.45) {
        // The wake: where things swim, the water lights up.
        const lvl = clamp(Math.floor((e - 0.45) * 5), 0, 5);
        glyph[i] = lvl >= 2 ? "•" : "·";
        fg[i] = pal.mix(pal.wake[0], pal.wake[1], pal.wake[2], ((lvl + 1) / 6) * a);
      }
    }
  }
}
