import { appHome, exec } from "herdr";
import { mkdir, readdir, readFile, writeFile, unlink } from "fs/promises";
import { onWindows, python, modFile } from "./platform.js";

export const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;
export const ATTACH_DIR = "cache/herdr-chat";
export function attachDir() { return onWindows() ? `${appHome()}\\cache\\herdr-chat` : `${appHome()}/${ATTACH_DIR}`; }
export const SENT_DIR = `${ATTACH_DIR}/sent`;
function sentDir() { return onWindows() ? `${attachDir()}\\sent` : `${appHome()}/${SENT_DIR}`; }

function cleanPart(s) { return String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "-"); }

export function previewName(path, machine) {
  // A placed image's name in sent/: its machine, its terminal's folder under files/, and its file name, so images named alike elsewhere stay apart.
  const parts = path.split(/[\\/]/);
  return `${cleanPart(machine) || "local"}~${cleanPart(parts.at(-2))}~${parts.at(-1)}`;
}

export async function keepSent(previews, placed, machine) {
  // Moves sent images' previews into sent/, under the names their placed paths give; returns the names kept.
  if (!previews.length) return [];
  await mkdir(sentDir(), { recursive: true }).catch(() => null);
  const kept = [];
  for (const [i, f] of previews.entries()) {
    const name = previewName(placed[i], machine);
    const bytes = await readFile(f).catch(() => null);
    if (!bytes) continue;
    // Herdr's writeFile can report success having written no bytes, so a preview only counts once it reads back whole; fetchSent makes one otherwise.
    const dest = `${sentDir()}/${name}`;
    await writeFile(dest, bytes).catch(() => null);
    const whole = await readFile(dest).then(back => back.length === bytes.length, () => false);
    if (whole) kept.push(name);
    else await unlink(dest).catch(() => null);
    await unlink(f).catch(() => null);
  }
  return kept;
}

const FETCH = `
import shutil, subprocess, sys
machine, path, dest = sys.argv[1:4]
if machine:
    read = "import sys;sys.stdout.buffer.write(open(sys.argv[1],'rb').read())"
    got = subprocess.run(["hc", "exec", "--on", machine, "python3", "-c", read, path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=25)
    if got.returncode: sys.exit(1)
    open(dest, "wb").write(got.stdout)
    print(len(got.stdout))
else:
    shutil.copyfile(path, dest)
    import os
    print(os.path.getsize(dest))
`;
const SHRINK_OVER = 250000;

async function shrink(name) {
  // A big preview in sent/ through the reply box's prepare script, as <name>.jpg in place of it; the name kept, or null when it can't be shrunk here.
  const source = `${sentDir()}/${name}`;
  const r = await (onWindows()
    ? exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", modFile("prepare-image.ps1"), "-Source", source, "-Folder", sentDir(), "-Name", name])
    : exec("sh", [modFile("prepare-image.sh"), source, sentDir(), name])).catch(() => null);
  const made = (r?.stdout ?? "").trim().split(/\r?\n/).pop().split(/[\\/]/).pop();
  if (r?.code === 0 && made === `${name}.jpg`) { await unlink(source).catch(() => null); return made; }
  if (made && made !== name) await unlink(`${sentDir()}/${made}`).catch(() => null);
  return null;
}

export async function fetchSent(path, machine) {
  // Copies an image herdr placed beside a terminal, on its machine (null: this one), into sent/, shrunk when big; the file's name there, or null.
  await mkdir(sentDir(), { recursive: true }).catch(() => null);
  const name = previewName(path, machine);
  const r = await python(["-c", FETCH, machine ?? "", path, `${sentDir()}/${name}`]).catch(() => null);
  if (!r || r.code !== 0) { await unlink(`${sentDir()}/${name}`).catch(() => null); return null; }
  return Number(r.stdout) > SHRINK_OVER ? (await shrink(name).catch(() => null)) ?? name : name;
}

export function previewFile(sent, path, machine) {
  // The file in sent/ that shows a placed image, as `sent` lists them: under its preview name, or that with .jpg when it was shrunk; null when there's none.
  const name = previewName(path, machine);
  return sent?.has(name) ? name : sent?.has(`${name}.jpg`) ? `${name}.jpg` : null;
}

export async function sentNames() {
  // The previews in sent/.
  return readdir(sentDir()).catch(() => []);
}

export function staleSent(names, listing) {
  // The previews whose terminal is gone, from `hc ls --all --json`; a machine that isn't connected keeps its own, since its terminals only look gone.
  if (!Array.isArray(listing?.machines) || !Array.isArray(listing?.terminals)) return [];
  const down = new Set(listing.machines.filter(m => m.state !== "connected").map(m => cleanPart(m.name)));
  const live = new Set(listing.terminals.map(t => {
    const at = t.address.lastIndexOf("/");
    return at < 0 ? `local~${cleanPart(t.address)}` : `${cleanPart(t.address.slice(0, at))}~${cleanPart(t.address.slice(at + 1))}`;
  }));
  return names.filter(n => {
    const [machine, terminal] = n.split("~");
    return !down.has(machine) && !live.has(`${machine}~${terminal}`);
  });
}

export async function dropSent(names) {
  // Deletes these previews from sent/.
  await Promise.all(names.map(n => unlink(`${sentDir()}/${n}`).catch(() => null)));
}

export function attachName(source) {
  // A unique name for the preview copy, without its extension (the prepare script picks it).
  const base = source.split(/[\\/]/).pop().replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "-").slice(-40) || "image";
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}-${base}`;
}
