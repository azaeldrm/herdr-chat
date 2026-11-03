// Small pieces of the chat's look, shared by its files.
import { svg } from "gpui-kit";
import { settings } from "herdr";
import { ICONS } from "./common.js";

/** The chat column's width: messages, the question card and the reply box. */
export const COLUMN = 740;

export function icon(name, size, color) { return svg(`${ICONS}/${name}.svg`).size(size).flex_none().text_color(color); }
export function mono() { return settings().font_family || settings().font || "JetBrains Mono"; }
