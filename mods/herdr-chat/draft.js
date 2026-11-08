import { shared, setShared } from "herdr";

const DRAFTS_KEY = "herdr-chat.drafts";
const DRAFTS_KEPT = 50;

export function savedDraft(key) {
  // The draft kept in shared state for session `key`, as { text, attachments }, or null.
  const v = (shared(DRAFTS_KEY) ?? {})[key];
  if (typeof v === "string") return v ? { text: v, attachments: [] } : null;
  return v && (v.text || v.attachments?.length) ? { text: v.text ?? "", attachments: v.attachments ?? [] } : null;
}

export function storeDraft(key, { text, attachments }) {
  // The one writer of kept drafts: text and images always go together, so neither outlives a reload without the other.
  const all = { ...(shared(DRAFTS_KEY) ?? {}) };
  const entry = text || attachments.length ? { text, attachments: attachments.map(({ name, file, rel }) => ({ name, file, rel })) } : null;
  if (JSON.stringify(all[key] ?? null) === JSON.stringify(entry)) return;
  delete all[key];
  if (entry) all[key] = entry;
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - DRAFTS_KEPT))) delete all[old];
  setShared(DRAFTS_KEY, all);
}

export function keptImages() {
  // Files the kept drafts still show, which cache pruning must leave alone.
  return Object.values(shared(DRAFTS_KEY) ?? {}).flatMap(v => typeof v === "object" && v ? (v.attachments ?? []).map(a => a.file) : []);
}
