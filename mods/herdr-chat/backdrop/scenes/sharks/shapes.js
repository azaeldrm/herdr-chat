// Shark outlines and fin layouts, from ascii-sharks' renderer.ts (MIT, see vendor/ascii-sharks/LICENSE).
// All values are fractions of the shark's length; s runs from the snout (0) to the tail (1).
import { smoothstep } from "../../vendor/ascii-sharks/math.js";

function classicHalfWidth(s) {
  if (s < 0.13) return 0.09 * Math.pow(Math.sin(((s / 0.13) * Math.PI) / 2), 0.95);
  if (s < 0.3) return 0.09 + 0.016 * smoothstep(0.13, 0.3, s);
  if (s < 0.84) return 0.019 + 0.087 * Math.pow(1 - (s - 0.3) / 0.54, 1.25);
  const k = (s - 0.84) / 0.16;
  return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
}

// halfWidth(s); pectoral [lead root, trail root, tip along, reach]; falcate: notched pectorals; pelvic likewise;
// caudal: forked tail reach (0 for a ribbon tail); dorsal and secondDorsal spans; head: a hammerhead's cephalofoil;
// eye span (null when the eyes sit on the cephalofoil); gills span; tint: skin colour multipliers.
export const SHAPES = {
  classic: {
    halfWidth: classicHalfWidth,
    pectoral: [0.15, 0.43, 0.55, 0.26], falcate: true, pelvic: [0.57, 0.65, 0.69, 0.085], caudal: 0.085,
    dorsal: [0.33, 0.47], secondDorsal: [0.71, 0.76], eye: [0.1, 0.14], gills: [0.19, 0.29], tint: [0.92, 0.97, 1.05],
  },
  hammerhead: {
    halfWidth: s => s < 0.06 ? 0.045 : s < 0.3 ? 0.045 + 0.061 * smoothstep(0.06, 0.3, s) : classicHalfWidth(s) * 0.92,
    head: { span: 0.17, sweep: 0.035, depth: 0.09, notch: 0 },
    pectoral: [0.17, 0.4, 0.5, 0.22], falcate: true, pelvic: [0.56, 0.63, 0.67, 0.075], caudal: 0.11,
    dorsal: [0.28, 0.44], secondDorsal: [0.7, 0.74], eye: null, gills: [0.16, 0.26], tint: [0.96, 0.98, 0.9],
  },
  tiger: {
    halfWidth: s => {
      if (s < 0.13) return 0.1 * Math.pow(Math.sin(((s / 0.13) * Math.PI) / 2), 0.45);
      if (s < 0.3) return 0.1 + 0.014 * smoothstep(0.13, 0.3, s);
      if (s < 0.84) return 0.019 + 0.095 * Math.pow(1 - (s - 0.3) / 0.54, 1.2);
      const k = (s - 0.84) / 0.16;
      return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
    },
    pectoral: [0.15, 0.42, 0.53, 0.25], falcate: true, pelvic: [0.57, 0.65, 0.69, 0.085], caudal: 0.095,
    dorsal: [0.33, 0.46], secondDorsal: [0.71, 0.75], eye: [0.08, 0.12], gills: [0.19, 0.28], tint: [1.02, 0.95, 0.84],
  },
  zebra: {
    halfWidth: s => {
      if (s < 0.1) return 0.075 * Math.pow(Math.sin(((s / 0.1) * Math.PI) / 2), 0.7);
      if (s < 0.28) return 0.075 + 0.025 * smoothstep(0.1, 0.28, s);
      if (s < 0.55) return 0.022 + 0.078 * Math.pow(1 - (s - 0.28) / 0.27, 1.1);
      const k = (s - 0.55) / 0.45;
      return 0.022 * (1 - k * k) + 0.012 * Math.sin(k * Math.PI);
    },
    pectoral: [0.12, 0.3, 0.36, 0.19], falcate: false, pelvic: [0.42, 0.48, 0.51, 0.065], caudal: 0,
    dorsal: [0.36, 0.44], secondDorsal: [0.49, 0.53], eye: [0.06, 0.09], gills: [0.13, 0.2], tint: [1.08, 0.97, 0.74],
  },
  greathammer: {
    halfWidth: s => s < 0.05 ? 0.04 : s < 0.3 ? 0.04 + 0.07 * smoothstep(0.05, 0.3, s) : classicHalfWidth(s) * 0.95,
    head: { span: 0.21, sweep: 0.006, depth: 0.085, notch: 0.014 },
    pectoral: [0.16, 0.38, 0.49, 0.24], falcate: true, pelvic: [0.55, 0.62, 0.67, 0.085], caudal: 0.13,
    dorsal: [0.24, 0.45], secondDorsal: [0.68, 0.74], eye: null, gills: [0.15, 0.25], tint: [0.86, 0.93, 1.02],
  },
  mako: {
    halfWidth: s => {
      if (s < 0.17) return 0.088 * Math.pow(Math.sin(((s / 0.17) * Math.PI) / 2), 1.5);
      if (s < 0.32) return 0.088 + 0.012 * smoothstep(0.17, 0.32, s);
      if (s < 0.86) return 0.014 + 0.086 * Math.pow(1 - (s - 0.32) / 0.54, 1.45);
      const k = (s - 0.86) / 0.14;
      return 0.014 * (1 - k) + 0.01 * Math.sin(k * Math.PI);
    },
    pectoral: [0.18, 0.4, 0.5, 0.21], falcate: true, pelvic: [0.58, 0.64, 0.68, 0.06], caudal: 0.13,
    dorsal: [0.34, 0.45], secondDorsal: [0.76, 0.79], eye: [0.11, 0.15], gills: [0.2, 0.3], tint: [0.78, 0.9, 1.2],
  },
  thresher: {
    halfWidth: s => {
      if (s < 0.08) return 0.07 * Math.pow(Math.sin(((s / 0.08) * Math.PI) / 2), 0.75);
      if (s < 0.2) return 0.07 + 0.02 * smoothstep(0.08, 0.2, s);
      if (s < 0.48) return 0.012 + 0.078 * Math.pow(1 - (s - 0.2) / 0.28, 1.3);
      const k = (s - 0.48) / 0.52;
      return 0.012 * (1 - k) + 0.006 * Math.sin(k * Math.PI * 0.9) + 0.002;
    },
    pectoral: [0.12, 0.27, 0.36, 0.2], falcate: true, pelvic: [0.37, 0.41, 0.44, 0.045], caudal: 0,
    dorsal: [0.24, 0.32], secondDorsal: [0.45, 0.47], eye: [0.05, 0.1], gills: [0.11, 0.18], tint: [1.0, 0.9, 1.08],
  },
  nurse: {
    halfWidth: s => {
      if (s < 0.08) return 0.085 * Math.pow(Math.sin(((s / 0.08) * Math.PI) / 2), 0.4);
      if (s < 0.3) return 0.085 + 0.02 * smoothstep(0.08, 0.3, s);
      if (s < 0.72) return 0.022 + 0.083 * Math.pow(1 - (s - 0.3) / 0.42, 1.1);
      const k = (s - 0.72) / 0.28;
      return 0.022 * (1 - k * k) + 0.014 * Math.sin(k * Math.PI);
    },
    pectoral: [0.16, 0.34, 0.4, 0.17], falcate: false, pelvic: [0.45, 0.52, 0.55, 0.075], caudal: 0,
    dorsal: [0.5, 0.58], secondDorsal: [0.63, 0.69], eye: [0.05, 0.075], gills: [0.14, 0.22], tint: [1.1, 0.96, 0.76],
  },
};

export const KINDS = Object.keys(SHAPES);
