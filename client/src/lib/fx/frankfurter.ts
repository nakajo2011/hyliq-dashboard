import type { FxRate } from "./types";

// Frankfurter moved to api.frankfurter.dev/v1 in 2025; the old .app host
// returns a 301 redirect. Use the new host directly to skip the round-trip.
const BASE_URL = "https://api.frankfurter.dev/v1";

export interface FrankfurterFetchResult {
  /** The actual start date returned by the API (may differ slightly from requested). */
  startDate: string;
  endDate: string;
  rates: FxRate[];
}

interface FrankfurterRangeResponse {
  amount: number;
  base: string;
  start_date: string;
  end_date: string;
  rates: Record<string, { JPY?: number }>;
}

/**
 * Fetch USD/JPY rates for a date range from the Frankfurter API
 * (https://www.frankfurter.app — free, no API key, ECB-published rates).
 *
 * Returns only the dates that the ECB published a rate for, so weekends
 * and holidays are silently skipped (carry-forward handles those at
 * lookup time).
 *
 * `from` and `to` must be in YYYY-MM-DD form.
 */
export async function fetchFrankfurterRange(
  from: string,
  to: string
): Promise<FrankfurterFetchResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error("日付は YYYY-MM-DD 形式で指定してください");
  }
  if (from > to) {
    throw new Error("開始日が終了日より後になっています");
  }

  const url = `${BASE_URL}/${from}..${to}?from=USD&to=JPY`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Frankfurter API エラー: ${res.status} ${res.statusText}`
    );
  }
  const data = (await res.json()) as FrankfurterRangeResponse;
  const rates: FxRate[] = [];
  for (const [date, currencies] of Object.entries(data.rates ?? {})) {
    const jpy = currencies.JPY;
    if (typeof jpy === "number" && isFinite(jpy) && jpy > 0) {
      rates.push({ date, usd_jpy: jpy });
    }
  }
  rates.sort((a, b) => a.date.localeCompare(b.date));
  return {
    startDate: data.start_date,
    endDate: data.end_date,
    rates,
  };
}
