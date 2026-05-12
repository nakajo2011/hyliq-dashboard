import type { TradeLike } from "../pnl";

/** Trade with the extra account info needed for grouping in the tax report. */
export interface TaxTradeInput extends TradeLike {
  id: string;
  accountName: string;
}

export interface TaxReportRow {
  tradeId: string;
  accountName: string;
  /** JST YYYY-MM-DD of the trade. */
  date: string;
  coin: string;
  dir: string;
  px: number;
  sz: number;
  pnl_usd: number;
  fee_usd: number;
  fx_rate: number | null;
  fx_date: string | null;
  fx_carried_forward: boolean;
  pnl_jpy: number | null;
}

export interface MonthlyTotal {
  /** YYYY-MM */
  month: string;
  rows: number;
  pnl_usd: number;
  /** Sum of non-null JPY values. */
  pnl_jpy: number;
  /** Number of rows in this month whose rate could not be resolved. */
  missing: number;
}

export interface TaxReport {
  year: number;
  rows: TaxReportRow[];
  monthlyTotals: MonthlyTotal[];
  total: {
    rows: number;
    pnl_usd: number;
    pnl_jpy: number;
    missing: number;
  };
  /** Distinct years that appear in the source trade data. */
  availableYears: number[];
}
