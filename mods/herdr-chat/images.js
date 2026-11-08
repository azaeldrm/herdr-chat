import { appHome } from "herdr";
import { onWindows } from "./platform.js";

export const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;
export const ATTACH_DIR = "cache/herdr-chat";
export function attachDir() { return onWindows() ? `${appHome()}\\cache\\herdr-chat` : `${appHome()}/${ATTACH_DIR}`; }
export function attachName(source) {
  // A unique name for the preview copy, without its extension (the prepare script picks it).
  const base = source.split(/[\\/]/).pop().replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "-").slice(-40) || "image";
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}-${base}`;
}
