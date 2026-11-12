// The sharks scene's settings: how fast the sharks live and who's in the water.
import { KINDS } from "./shapes.js";

/** How much faster the sharks live than the fish (the sim's own sharks cruise slowly). */
export const SHARK_SPEED = 1.6;
/** Three sharks of different kinds, a new mix each time: the first is the biggest, and all of them larger than the sim's own, which is sized for a full page. */
export function pickSharks(random = Math.random) {
  const pool = [...KINDS], out = [];
  for (const size of [1.6, 1.3, 1.1]) out.push({ kind: pool.splice(Math.floor(random() * pool.length), 1)[0], size });
  return out;
}
