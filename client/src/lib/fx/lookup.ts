import type { FxRate, FxResolution } from "./types";

export type FxLookup = (date: string) => FxResolution | null;

/**
 * Build a date → USD/JPY lookup that:
 * - returns the rate for an exact date match if present
 * - otherwise falls back to the most recent rate before that date (carry-forward
 *   handles weekends/holidays as is standard for 確定申告 calculations)
 * - returns null when no prior rate exists
 */
export function buildFxLookup(rates: FxRate[]): FxLookup {
  const sorted = [...rates].sort((a, b) => a.date.localeCompare(b.date));
  return (date: string) => {
    let chosen: FxRate | null = null;
    for (const r of sorted) {
      if (r.date <= date) chosen = r;
      else break;
    }
    if (!chosen) return null;
    return {
      rate: chosen.usd_jpy,
      fxDate: chosen.date,
      carriedForward: chosen.date !== date,
    };
  };
}

/**
 * Parse a bulk-pasted block like:
 *   2026-04-02 150.50
 *   2026/04/03  150.30
 *   2026-04-04,150.10
 * Returns successfully-parsed rates plus per-line errors.
 */
export function parseBulkFxInput(input: string): {
  rates: FxRate[];
  errors: { line: number; raw: string; message: string }[];
} {
  const rates: FxRate[] = [];
  const errors: { line: number; raw: string; message: string }[] = [];

  const lines = input.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[\s,	]+(-?\d+(?:\.\d+)?)/);
    if (!m) {
      errors.push({ line: i + 1, raw, message: "形式を認識できません" });
      continue;
    }
    const [, y, mo, d, value] = m;
    const pad = (s: string) => s.padStart(2, "0");
    const date = `${y}-${pad(mo)}-${pad(d)}`;
    const rate = Number(value);
    if (!isFinite(rate) || rate <= 0) {
      errors.push({ line: i + 1, raw, message: "レートが不正です" });
      continue;
    }
    rates.push({ date, usd_jpy: rate });
  }

  return { rates, errors };
}
