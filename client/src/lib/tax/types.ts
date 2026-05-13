import type { TradeLike } from "../pnl";

export type TaxRowKind = "trade" | "funding" | "transfer";

/** Trade input enriched with the account name for the report. */
export interface TaxTradeInput extends TradeLike {
  id: string;
  accountName: string;
}

export interface TaxFundingInput {
  id: string;
  accountName: string;
  time: string;
  coin: string;
  side: string;
  payment: number;
}

export interface TaxTransferInput {
  id: string;
  accountName: string;
  time: string;
  action: string;
  source: string;
  destination: string;
  account_value_change: number;
  fee: number;
  currency: string;
  /** Only `taxable === true` transfers appear in the report. */
  taxable: boolean;
}

/** One line in the report — common shape across the 3 kinds. */
export interface TaxReportRow {
  kind: TaxRowKind;
  /** ID of the original record. */
  id: string;
  accountName: string;
  /** YYYY-MM-DD (JST). */
  date: string;
  /** Human-readable description (trade dir+coin, "Funding ETH", "send USDC →trading"). */
  description: string;
  /** For trade rows. Other kinds: empty. */
  coin: string;
  dir: string;
  /** For trade rows. Other kinds: 0. */
  px: number;
  sz: number;
  amount_usd: number;
  fee_usd: number;
  fx_rate: number | null;
  fx_date: string | null;
  fx_carried_forward: boolean;
  amount_jpy: number | null;
}

export interface KindSummary {
  rows: number;
  amount_usd: number;
  amount_jpy: number;
}

export interface MonthlyTotal {
  /** YYYY-MM */
  month: string;
  trade: KindSummary;
  funding: KindSummary;
  transfer: KindSummary;
  total: KindSummary;
  /** Number of rows in this month whose rate could not be resolved. */
  missing: number;
}

export interface TotalSummary extends KindSummary {
  trade: KindSummary;
  funding: KindSummary;
  transfer: KindSummary;
  missing: number;
}

export interface TaxReport {
  year: number;
  rows: TaxReportRow[];
  monthlyTotals: MonthlyTotal[];
  total: TotalSummary;
  /** Distinct years that appear in any of the source data sets. */
  availableYears: number[];
}
