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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** [start, end) JST ms boundaries for the current calendar month. */
function currentMonthRangeMs(): { startMs: number; endMs: number } {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth() + 1;
  const mm = String(m).padStart(2, "0");
  const startMs = Date.parse(`${y}-${mm}-01T00:00:00+09:00`);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const endMs = Date.parse(
    `${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+09:00`
  );
  return { startMs, endMs };
}

export interface SyncAllProgress {
  /** Accounts fully finished so far. */
  completed: number;
  total: number;
  /** Account currently being synced, or null between accounts. */
  currentAccount: string | null;
}

export interface SyncAllAccountResult {
  accountName: string;
  ok: boolean;
  result?: SyncResult;
  error?: string;
}

/**
 * Sync the current calendar month for every account that has a valid
 * address. Accounts are processed strictly one at a time, with a delay
 * between them, so the public API is not hammered (DoS-considerate).
 */
export async function syncAllAccountsCurrentMonth(
  accounts: { name: string; address: string }[],
  opts: { onProgress?: (p: SyncAllProgress) => void; delayMs?: number } = {}
): Promise<SyncAllAccountResult[]> {
  const delayMs = opts.delayMs ?? 1000;
  const targets = accounts.filter((a) => isHyperliquidAddress(a.address));
  const { startMs, endMs } = currentMonthRangeMs();
  const results: SyncAllAccountResult[] = [];

  for (let i = 0; i < targets.length; i++) {
    const a = targets[i];
    // 1s gap between accounts (not before the first).
    if (i > 0) await sleep(delayMs);
    opts.onProgress?.({
      completed: i,
      total: targets.length,
      currentAccount: a.name,
    });
    try {
      const result = await syncFromHyperliquid({
        accountName: a.name,
        address: a.address,
        startTime: startMs,
        endTime: endMs,
      });
      results.push({ accountName: a.name, ok: true, result });
    } catch (e) {
      results.push({
        accountName: a.name,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    opts.onProgress?.({
      completed: i + 1,
      total: targets.length,
      currentAccount: null,
    });
  }
  return results;
}
