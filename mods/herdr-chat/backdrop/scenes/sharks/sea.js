// ascii-sharks' World with the sharks on a faster clock than the fish: everything a shark does (swimming, turning,
// its tail beat, getting hungry) runs SHARK_SPEED times as fast. The vendored sim stays as it is.
import { World } from "../../vendor/ascii-sharks/world.js";
import { SHARK_SPEED } from "./config.js";

export class Sea extends World {
  stepSharks(dt) { super.stepSharks(dt * SHARK_SPEED); }
}
