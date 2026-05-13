/**
 * Canonical PocketBase record shapes used across pages.
 *
 * These mirror the migration in pb_migrations/1747000000_init_collections.js.
 * Page-local types (e.g. `AccountRow` augmented with computed trade counts)
 * should compose these via intersection rather than redeclare them.
 */

export interface AccountRecord {
  id: string;
  name: string;
  address: string;
  note: string;
  created: string;
  updated: string;
}

export interface TradeRecord {
  id: string;
  account: string; // FK → accounts.id
  time: string;
  coin: string;
  dir: string;
  px: number;
  sz: number;
  ntl: number;
  fee: number;
  closed_pnl: number;
  hash: string;
  created: string;
  updated: string;
}

export interface FundingRecord {
  id: string;
  account: string;
  time: string;
  coin: string;
  sz: number;
  side: string;
  payment: number;
  rate: number;
  hash: string;
  created: string;
  updated: string;
}

export interface TransferRecord {
  id: string;
  account: string;
  time: string;
  action: string;
  source: string;
  destination: string;
  account_value_change: number;
  fee: number;
  currency: string;
  hash: string;
  /**
   * Whether this transfer should be included in 確定申告 as taxable income.
   * Most deposits are self-transfers (not taxable); set to true only for
   * actual income (e.g., payment received, gift, sale proceeds).
   */
  taxable: boolean;
  created: string;
  updated: string;
}

export interface FxRecord {
  id: string;
  /** ISO datetime, e.g. "2026-04-02 00:00:00.000Z". */
  date: string;
  usd_jpy: number;
  source: string;
  note: string;
  created: string;
  updated: string;
}
