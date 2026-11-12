// What a session runs with, for the line under the message box (the model chip first): the model and what it can switch
// to, the effort, the permission mode and the context used, from the reader's META (the newest values its log gave) and the
// harness (its models, efforts and how it switches).

export function modelName(id) {
  // "claude-opus-5-5" as "Opus 5.5"; other models as they're named.
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(String(id ?? ""));
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : String(id ?? "");
}

export function tokens(n) {
  // 80341 as "80k", 1250000 as "1.25M", 1000000 as "1M".
  if (n >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

export function runsWith(meta, harness = {}) {
  // { model, models, effort, efforts, mode, context } (each null or empty when unknown):
  //   model { id, name }; models [{ id, name, switchTo, efforts? }] (switchTo: what the switch command names it);
  //   mode { key, text }; context { used, window?, share? }.
  meta = meta ?? {};
  const listed = (harness.models ?? meta.models ?? []).map(m => ({ id: m.id, name: m.name ?? modelName(m.id), switchTo: m.alias ?? m.id, efforts: m.efforts, window: m.window }));
  const current = meta.model ? listed.find(m => m.id === meta.model || String(meta.model).startsWith(m.id)) : null;
  const model = meta.model ? { id: meta.model, name: current?.name ?? modelName(meta.model) } : null;
  const efforts = harness.efforts ?? current?.efforts ?? [];
  const window = Number.isFinite(meta.window) && meta.window > 0 ? meta.window : current?.window ?? null;
  const used = Number.isFinite(meta.context) && meta.context > 0 ? meta.context : null;
  return {
    model,
    models: listed,
    effort: meta.effort ?? null,
    efforts,
    mode: meta.mode ? { key: meta.mode, text: harness.modes?.[meta.mode] ?? meta.mode } : null,
    context: used == null ? null : { used, window, share: window ? Math.min(100, Math.round(100 * used / window)) : null },
  };
}

export function switchCommand(harness, what, values) {
  // The line that switches `what` ("model" or "effort"), its {model} and {effort} filled in; null when the harness can't.
  const pattern = harness?.switching?.[what];
  if (!pattern) return null;
  return pattern.replace(/\{(\w+)\}/g, (_all, name) => values[name] ?? "");
}
