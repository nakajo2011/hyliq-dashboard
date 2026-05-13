export type RateSource = "mizuho" | "frankfurter";

export const SOURCE_STORAGE_KEY = "hyliq.fxSource";

export const SOURCE_LABEL: Record<RateSource, string> = {
  mizuho: "みずほ TTM",
  frankfurter: "Frankfurter (ECB)",
};

export function loadSourceFromStorage(): RateSource | null {
  try {
    const v = localStorage.getItem(SOURCE_STORAGE_KEY);
    if (v === "mizuho" || v === "frankfurter") return v;
  } catch {
    // localStorage unavailable
  }
  return null;
}

export function persistSource(s: RateSource | null) {
  try {
    if (s) localStorage.setItem(SOURCE_STORAGE_KEY, s);
    else localStorage.removeItem(SOURCE_STORAGE_KEY);
  } catch {
    // ignore
  }
}
