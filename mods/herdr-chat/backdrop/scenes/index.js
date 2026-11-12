// Every scene the backdrop can show, in the order the chat's button steps through them.
import { SharksScene } from "./sharks/scene.js";
import { SkyScene } from "./sky.js";
import { RainScene } from "./rain.js";
import { JellyfishScene } from "./jellyfish.js";

export const SCENES = [
  { id: "sharks", label: "Sharks", make: () => new SharksScene() },
  { id: "jellyfish", label: "Jellyfish", make: () => new JellyfishScene() },
  { id: "sky", label: "Night sky", make: () => new SkyScene() },
  { id: "rain", label: "Rain", make: () => new RainScene() },
];

export const sceneFor = id => SCENES.find(s => s.id === id) ?? SCENES[0];
export const nextScene = id => SCENES[(SCENES.indexOf(sceneFor(id)) + 1) % SCENES.length];
