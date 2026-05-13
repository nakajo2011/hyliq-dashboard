import { buildFxLookup, type FxRate } from "../fx";
import { dateKeyJst } from "./aggregate";
import type { TradeLike } from "./types";

export interface ConvertedTrade extends TradeLike {
  /** YYYY-MM-DD (JST) for the trade. */
  date: string;
  /** Rate used for this trade, or null if not resolvable. */
  fx_rate: number | null;
  /** Trade PnL converted to JPY, or null if no rate was available. */
  pnl_jpy: number | null;
}

export interface ConversionResult {
  trades: ConvertedTrade[];
  /** Number of trades whose rate could not be resolved (null pnl_jpy). */
  missingCount: number;
}

/**
 * Convert each trade's PnL to JPY using the per-trade-date USD/JPY rate
 * (with carry-forward to the previous business day for weekends/holidays,
 * matching NTA practice for derivatives income — see 国税庁 FAQ on 暗号資産
 * デリバティブの差金決済).
 */
export function convertTradesToJpy(
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
  return { trades: converted, missingCount: missing };
}
