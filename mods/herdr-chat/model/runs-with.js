// What a session runs with, as the strip under the message box says it: model, effort, permission mode and context used,
// from the reader's META (newest values its log gave).

export function modelName(id) {
  // "claude-opus-5-5" as "Opus 5.5"; other models as they're named.
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(String(id ?? ""));
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : String(id ?? "");
}

export function tokens(n) {
  // 80341 as "80k", 1250000 as "1.25M".
  if (n >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

export function runsWith(meta, modes = {}) {
  // The strip's parts, in order: { key, text, title? }; empty when the log hasn't said. `modes`: the harness's names for its
  // permission modes, by the log's word for them.
  if (!meta) return [];
  const parts = [];
  if (meta.model) parts.push({ key: "model", text: modelName(meta.model), title: meta.model });
  if (meta.effort) parts.push({ key: "effort", text: `${meta.effort} effort` });
  if (meta.mode) parts.push({ key: "mode", text: modes[meta.mode] ?? meta.mode });
  if (Number.isFinite(meta.context) && meta.context > 0) {
    const share = Number.isFinite(meta.window) && meta.window > 0 ? Math.round(100 * meta.context / meta.window) : null;
    parts.push({ key: "context", text: share == null ? `${tokens(meta.context)} context` : `${share}% context`,
      title: share == null ? `${meta.context.toLocaleString()} tokens of context in use` : `${tokens(meta.context)} of ${tokens(meta.window)} tokens of context in use` });
  }
  return parts;
}
