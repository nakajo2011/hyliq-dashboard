/**
 * Orchestrate "sync from Hyperliquid for the last N days":
 *   fetch → transform → commit (using the same `commitGroup` as CSV ingest).
 *
 * Scope is intentionally narrow for the PoC: single fetch per endpoint
 * (max 2000 fills / 500 funding+ledger), no pagination retry, last 7 days
 * by default. If the user has more than that in a week we surface a warning
 * so they can re-run the CSV import path.
 */

import { commitGroup, type CommitGroupResult } from "../persistence";
import {
  fetchUserFillsByTime,
  fetchUserFunding,
  fetchUserNonFundingLedgerUpdates,
} from "./api";
import {
  transformFills,
  transformFundings,
  transformLedgerUpdates,
} from "./transform";

export interface SyncOptions {
  accountName: string;
  address: string;
  /** Inclusive ms timestamp; defaults to now - 7 days. */
  startTime?: number;
  /** Inclusive ms timestamp; defaults to now. */
  endTime?: number;
}

export interface SyncResult {
  range: { startTime: number; endTime: number };
  trades: CommitGroupResult;
  fundings: CommitGroupResult;
  transfers: CommitGroupResult;
  /** Non-fatal warnings (e.g. response hit the per-call cap, unknown types). */
  warnings: string[];
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const FILL_LIMIT = 2000;
const LEDGER_LIMIT = 500;

export function isHyperliquidAddress(addr: string): boolean {
  return ADDRESS_RE.test(addr.trim());
}

export async function syncFromHyperliquid(
  opts: SyncOptions
): Promise<SyncResult> {
  const address = opts.address.trim();
  if (!isHyperliquidAddress(address)) {
    throw new Error(`不正なアドレス形式: ${address}`);
  }
  const endTime = opts.endTime ?? Date.now();
  const startTime = opts.startTime ?? endTime - 7 * 24 * 60 * 60 * 1000;

  const warnings: string[] = [];

  const [fills, fundings, ledger] = await Promise.all([
    fetchUserFillsByTime(address, startTime, endTime),
    fetchUserFunding(address, startTime, endTime),
    fetchUserNonFundingLedgerUpdates(address, startTime, endTime),
  ]);

  if (fills.length >= FILL_LIMIT) {
    warnings.push(
      `取引が ${FILL_LIMIT} 件以上検出されました。古い行は含まれていない可能性があります (PoC ではページング未対応)。`
    );
  }
  if (fundings.length >= LEDGER_LIMIT) {
    warnings.push(
      `ファンディングが ${LEDGER_LIMIT} 件以上検出されました。古い行は含まれていない可能性があります。`
    );
  }
  if (ledger.length >= LEDGER_LIMIT) {
    warnings.push(
      `入出金が ${LEDGER_LIMIT} 件以上検出されました。古い行は含まれていない可能性があります。`
    );
  }

  const tradeResult = await transformFills(fills, opts.accountName);
  if (tradeResult.skippedNonPerp > 0) {
    warnings.push(
      `Perp 以外 (Spot 等) の fill ${tradeResult.skippedNonPerp} 件をスキップ`
    );
  }
  const fundingRows = await transformFundings(fundings, opts.accountName);
  const ledgerResult = await transformLedgerUpdates(ledger, opts.accountName);
  if (ledgerResult.skippedUnknown > 0) {
    warnings.push(
      `Ledger 更新で未対応の type ${ledgerResult.skippedUnknown} 件をスキップ`
    );
  }

  // commitGroup creates the account if missing (by name) and inserts rows
  // whose hash isn't already present.
  const [trades, savedFundings, transfers] = await Promise.all([
    commitGroup(opts.accountName, "trade", tradeResult.rows),
    commitGroup(opts.accountName, "funding", fundingRows),
    commitGroup(opts.accountName, "transfer", ledgerResult.rows),
  ]);

  return {
    range: { startTime, endTime },
    trades,
    fundings: savedFundings,
    transfers,
    warnings,
  };
}
