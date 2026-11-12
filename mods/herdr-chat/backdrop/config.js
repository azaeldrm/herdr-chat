// The backdrop's settings: its cell grid and its frame rate.

/** Frames a second while it's shown; each scene steps once a frame. A frame costs about 18 ms in herdr's engine at a
 *  chat-sized page with 13 px cells (sim 3, sharks 8, wake 2, paint 3, runs 1.5), so 30 fps is about 60% of a core
 *  while it moves (estimated from that, not measured live): the most this can afford, and only while a welcome or empty chat is in front.
 *  Sharks are the costliest scene; the others take 3–8 ms. */
export const FPS = 30;
/** How often it looks again, while hidden, resting or while the window is in the background. */
export const IDLE_MS = 1000;
/** After this long shown with the pointer still, the backdrop rests on its last frame; moving over it wakes it. */
export const REST_MS = 45000;

/** Cells for JetBrains Mono (a 0.6 em advance) at `font` px: glyphs abut, rows have a little air. */
export function cellSize(font = 13) {
  return { font, cw: font * 0.6, ch: Math.round(font * 1.3) };
}
