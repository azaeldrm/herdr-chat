// Sharks hunting fish schools: ascii-sharks' sim, drawn by cells.js.
import { Sea } from "./sea.js";
import { SharkCells } from "./cells.js";
import { pickSharks } from "./config.js";

export class SharksScene {
  constructor() {
    this.world = new Sea(pickSharks());
    this.grid = new SharkCells();
    this.pointer = this.world.pointer;
  }
  resize(width, height, cw, ch) { this.grid.resize(width, height, cw, ch); this.world.resize(width, height, cw, ch); }
  setDim(dim) { this.grid.setDim(dim); }
  frame(dt, pal) { this.world.step(dt); this.grid.frame(this.world, dt, pal); }
  splash(x, y) { this.world.splash(x, y); }
}
