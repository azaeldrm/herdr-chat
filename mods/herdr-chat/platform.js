import { appHome, exec } from "herdr";

export function onWindows() { return appHome().includes("\\"); }

export function modFile(name) {
  // A file of this mod, as a path for programs to open.
  return onWindows() ? `${appHome()}\\mods\\herdr-chat\\${name}` : `${appHome()}/mods/herdr-chat/${name}`;
}

export function psQuote(s) {
  // `s` as a PowerShell single-quoted string.
  return `'${String(s).replace(/'/g, "''")}'`;
}

export function base64Utf8(text) {
  // Text as base64 of its UTF-8 bytes (no Buffer or btoa here).
  const bytes = [];
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | c >> 6, 0x80 | c & 63);
    else if (c < 0x10000) bytes.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    else bytes.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
  }
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes[i] << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0);
    out += abc[n >> 18 & 63] + abc[n >> 12 & 63] + (i + 1 < bytes.length ? abc[n >> 6 & 63] : "=") + (i + 2 < bytes.length ? abc[n & 63] : "=");
  }
  return out;
}

export function removeFiles(files) {
  // Deletes files on this computer, quietly (ones already gone are fine).
  if (!files.length) return;
  (onWindows()
    ? exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath ${files.map(psQuote).join(", ")}`])
    : exec("rm", ["-f", "--", ...files])).catch(() => null);
}

export function pruneOld(dir) {
  // Deletes the files in `dir`, and the folders in it, older than a day.
  (onWindows()
    ? exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `Get-ChildItem -LiteralPath ${psQuote(dir)} -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } | Remove-Item -Force`])
    : exec("sh", ["-c", '[ -d "$1" ] && find "$1" -type f -mmin +1440 -delete; exit 0', "sh", dir])).catch(() => null);
}
