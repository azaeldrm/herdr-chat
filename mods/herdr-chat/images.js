import { appHome } from "herdr";
import { mkdir, readdir, readFile, writeFile, unlink } from "fs/promises";
import { onWindows, python, fromBase64 } from "./platform.js";

export const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;
export const ATTACH_DIR = "cache/herdr-chat";
export function attachDir() { return onWindows() ? `${appHome()}\\cache\\herdr-chat` : `${appHome()}/${ATTACH_DIR}`; }
export const SENT_DIR = `${ATTACH_DIR}/sent`;
const SENT_DAYS = 30, SENT_MAX = 300;
function sentDir() { return onWindows() ? `${attachDir()}\\sent` : `${appHome()}/${SENT_DIR}`; }

export function previewName(path, machine) {
  // A placed image's name in sent/: its machine, its terminal's folder under files/, and its file name, so images named alike elsewhere stay apart.
  const clean = s => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "-");
  const parts = path.split(/[\\/]/);
  return `${clean(machine) || "local"}~${clean(parts.at(-2))}~${parts.at(-1)}`;
}

export async function keepSent(previews, placed, machine) {
  // Moves sent images' previews into sent/, under the names their placed paths give; returns the names kept.
  if (!previews.length) return [];
  await mkdir(sentDir(), { recursive: true }).catch(() => null);
  const kept = [];
  for (const [i, f] of previews.entries()) {
    const name = previewName(placed[i], machine);
    const moved = await readFile(f).then(b => writeFile(`${sentDir()}/${name}`, b)).then(() => true, () => false);
    if (moved) { kept.push(name); await unlink(f).catch(() => null); }
  }
  return kept;
}

const FETCH = "import base64,os,sys;p=sys.argv[1];os.path.getsize(p)<8000000 or sys.exit(1);sys.stdout.write(base64.b64encode(open(p,'rb').read()).decode())";

export async function fetchSent(path, machine) {
  // Copies an image herdr placed beside a terminal, on its machine (null: this one), into sent/ under its preview name; true when it landed.
  const r = await python(["-c", FETCH, path], machine ? { on: machine } : undefined).catch(() => null);
  if (!r || r.code !== 0 || !r.stdout.trim()) return false;
  await mkdir(sentDir(), { recursive: true }).catch(() => null);
  return writeFile(`${sentDir()}/${previewName(path, machine)}`, fromBase64(r.stdout)).then(() => true, () => false);
}

function madeAt(name) {
  // When a preview was made, from the base-36 time that starts its file name (attachName); 0 when it has none.
  const file = name.split("~").slice(2).join("~");
  const at = parseInt(file.slice(0, 8), 36);
  return /^[0-9a-z]{8}/.test(file) && at > 0 ? at : 0;
}

export async function sentNames() {
  // The kept previews, newest last, after dropping those older than SENT_DAYS or beyond the newest SENT_MAX.
  const dir = sentDir();
  const names = await readdir(dir).catch(() => []);
  const files = names.map(n => ({ n, at: madeAt(n) })).sort((a, b) => a.at - b.at);
  const oldest = Date.now() - SENT_DAYS * 86400000;
  const drop = files.filter((f, i) => (f.at && f.at < oldest) || i < files.length - SENT_MAX);
  await Promise.all(drop.map(f => unlink(`${dir}/${f.n}`).catch(() => null)));
  return files.filter(f => !drop.includes(f)).map(f => f.n);
}

export function attachName(source) {
  // A unique name for the preview copy, without its extension (the prepare script picks it).
  const base = source.split(/[\\/]/).pop().replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "-").slice(-40) || "image";
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}-${base}`;
}
