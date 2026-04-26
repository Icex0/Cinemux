export type ProgressMap = Record<string, any>;

const PROGRESS_KEY = "vidup:progress";

export function readProgress(): ProgressMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(PROGRESS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function writeProgressEntries(entries: ProgressMap) {
  const all = readProgress();
  for (const [k, v] of Object.entries(entries)) {
    if (/^[mt]\d+$/.test(k)) all[k] = v;
  }
  window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
}

export function deleteProgressEntry(key: string) {
  const all = readProgress();
  if (!(key in all)) return;
  delete all[key];
  window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
}
