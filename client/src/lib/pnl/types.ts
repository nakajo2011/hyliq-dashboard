import type { TradeDir } from "../csv";

/** Subset of trade fields needed for PnL aggregation. */
export interface TradeLike {
  time: string;
  coin: string;
  dir: TradeDir;
  px: number;
  sz: number;
  fee: number;
  closed_pnl: number;
}

export interface FundingLike {
  time: string;
  coin: string;
  payment: number;
}

export interface TransferLike {
  time: string;
  action: string;
  source: string;
  destination: string;
  account_value_change: number;
  fee: number;
  currency: string;
}

export interface DailyPnLPoint {
  /** YYYY-MM-DD in JST. */
  date: string;
  /** Realized PnL on this day (after fees). */
  pnl: number;
  /** Running cumulative realized PnL from the first day. */
  cumulative: number;
}

export interface CoinPnL {
  coin: string;
  realizedPnl: number;
  fees: number;
  trades: number;
}

export interface OpenPosition {
  coin: string;
  side: "long" | "short";
  size: number;
  /** Weighted-average entry price across remaining lots. */
  avgEntry: number;
  notional: number;
}

export interface AccountStats {
  /** Sum of closed_pnl across all trades (already net of fees per Hyperliquid). */
  realizedPnl: number;
  /** Sum of trade fees (positive number). */
  totalFees: number;
  /** Net funding (received - paid). */
  fundingNet: number;
  /** Net deposits-withdrawals into the trading account. */
  netDeposits: number;
  /** Number of trades. */
  tradeCount: number;
}
