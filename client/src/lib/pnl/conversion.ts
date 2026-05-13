import { buildFxLookup, type FxRate } from "../fx";
import { dateKeyJst } from "./aggregate";
import type { TradeLike } from "./types";

export type ConversionMethod = "daily" | "total-average" | "moving-average";

export const CONVERSION_METHOD_LABEL: Record<ConversionMethod, string> = {
  daily: "日次レート",
  "total-average": "総平均法",
  "moving-average": "移動平均法",
};

export interface ConvertedTrade extends TradeLike {
  /** YYYY-MM-DD (JST) for the trade. */
  date: string;
  /** Rate used for this trade, or null if not resolvable. */
  fx_rate: number | null;
  /** Trade PnL converted to JPY, or null if no rate was available. */
  pnl_jpy: number | null;
}

export interface ConversionResult {
  method: ConversionMethod;
  trades: ConvertedTrade[];
  /** Number of trades whose rate could not be resolved (null pnl_jpy). */
  missingCount: number;
  /**
   * For total-average: the single rate applied to every trade.
   * For moving-average and daily: undefined (rate varies per trade).
   */
  effectiveRate?: number;
}

/**
 * Convert each trade's PnL to JPY using the specified method.
 *
 * - daily         per-trade-date rate with carry-forward (lib/fx default)
 * - total-average a single average rate computed across all supplied FX rates
 * - moving-average for each trade, the cumulative average of FX rates whose
 *                  date is on or before the trade date
 *
 * Notes on Japanese tax law:
 *   The strict 移動平均法 / 総平均法 for foreign currency tracks acquisitions
 *   and dispositions of the currency itself (USDC deposits + positive PnL on
 *   the income side, withdrawals + negative PnL on the disposition side).
 *   This module applies a simpler approximation that averages USD/JPY rates
 *   across the period — usually close enough for individual perp traders,
 *   and matches how most spreadsheet-based tax workflows treat foreign-
 *   currency-denominated income from derivatives.
 */
export function convertTradesToJpy(
  trades: TradeLike[],
  fxRates: FxRate[],
  method: ConversionMethod
): ConversionResult {
  switch (method) {
    case "daily":
      return convertDaily(trades, fxRates);
    case "total-average":
      return convertTotalAverage(trades, fxRates);
    case "moving-average":
      return convertMovingAverage(trades, fxRates);
  }
}

function convertDaily(
  trades: TradeLike[],
  fxRates: FxRate[]
): ConversionResult {
  const lookup = buildFxLookup(fxRates);
  let missing = 0;
  const converted: ConvertedTrade[] = trades.map((t) => {
    const date = dateKeyJst(t.time);
    const fx = lookup(date);
    if (!fx) missing++;
    return {
      ...t,
      date,
      fx_rate: fx?.rate ?? null,
      pnl_jpy: fx ? t.closed_pnl * fx.rate : null,
    };
  });
  return { method: "daily", trades: converted, missingCount: missing };
}

function convertTotalAverage(
  trades: TradeLike[],
  fxRates: FxRate[]
): ConversionResult {
  if (fxRates.length === 0) {
    return {
      method: "total-average",
      trades: trades.map((t) => ({
        ...t,
        date: dateKeyJst(t.time),
        fx_rate: null,
        pnl_jpy: null,
      })),
      missingCount: trades.length,
    };
  }
  const avg = fxRates.reduce((s, r) => s + r.usd_jpy, 0) / fxRates.length;
  const converted: ConvertedTrade[] = trades.map((t) => ({
    ...t,
    date: dateKeyJst(t.time),
    fx_rate: avg,
    pnl_jpy: t.closed_pnl * avg,
  }));
  return {
    method: "total-average",
    trades: converted,
    missingCount: 0,
    effectiveRate: avg,
  };
}

function convertMovingAverage(
  trades: TradeLike[],
  fxRates: FxRate[]
): ConversionResult {
  const sortedRates = [...fxRates].sort((a, b) => a.date.localeCompare(b.date));
  // Pre-compute cumulative averages by rate index
  const cumAvg: { date: string; avg: number }[] = [];
  let sum = 0;
  for (let i = 0; i < sortedRates.length; i++) {
    sum += sortedRates[i].usd_jpy;
    cumAvg.push({ date: sortedRates[i].date, avg: sum / (i + 1) });
  }

  const rateForDate = (date: string): number | null => {
    let last: number | null = null;
    for (const c of cumAvg) {
      if (c.date <= date) last = c.avg;
      else break;
    }
    return last;
  };

  let missing = 0;
  const converted: ConvertedTrade[] = trades.map((t) => {
    const date = dateKeyJst(t.time);
    const rate = rateForDate(date);
    if (rate == null) missing++;
    return {
      ...t,
      date,
      fx_rate: rate,
      pnl_jpy: rate != null ? t.closed_pnl * rate : null,
    };
  });
  return { method: "moving-average", trades: converted, missingCount: missing };
}
