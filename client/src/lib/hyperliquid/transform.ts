/**
 * Convert Hyperliquid Info-endpoint responses into the same shape the CSV
 * parsers produce, so we can pass them through the existing `commitGroup`
 * pipeline (which handles dedup + insert).
 *
 * The hash algorithm must match `client/src/lib/csv/parsers.ts` exactly so
 * that the same logical event imported via CSV and via API sync produces the
 * same hash → no duplicates.
 */

import { sha256Hex } from "../csv/hash";
import type {
  ParsedFunding,
  ParsedTrade,
  ParsedTransfer,
  TradeDir,
} from "../csv";
import type { HlFill, HlFunding, HlLedgerUpdate } from "./api";

const VALID_TRADE_DIRS = new Set<TradeDir>([
  "Open Long",
  "Close Long",
  "Open Short",
  "Close Short",
  "Long > Short",
  "Short > Long",
]);

/**
 * Format an epoch-ms timestamp the same way Hyperliquid's CSV export does:
 * `YYYY-MM-DDTHH:mm:ss+09:00` (JST, second precision, no milliseconds).
 *
 * Matching the CSV format here is what makes cross-source dedup work — the
 * `time` field participates in the hash on both sides.
 */
export function msToCsvIsoJst(ms: number): string {
  const jst = new Date(ms + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const mo = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const h = String(jst.getUTCHours()).padStart(2, "0");
  const mi = String(jst.getUTCMinutes()).padStart(2, "0");
  const s = String(jst.getUTCSeconds()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`;
}

/** Mirrors `accountKey` in parsers.ts — both sides of dedup must agree. */
function accountKey(accountName: string): string {
  return accountName.trim().toLowerCase();
}

export interface FillTransformResult {
  rows: ParsedTrade[];
  /** Fills skipped because `dir` was not one of the 6 perp directions
   *  (typically spot fills or unexpected values). */
  skippedNonPerp: number;
}

export async function transformFills(
  fills: HlFill[],
  accountName: string
): Promise<FillTransformResult> {
  const key = accountKey(accountName);
  const rows: ParsedTrade[] = [];
  let skipped = 0;

  for (const f of fills) {
    if (!VALID_TRADE_DIRS.has(f.dir as TradeDir)) {
      skipped++;
      continue;
    }
    const time = msToCsvIsoJst(f.time);
    const px = Number(f.px);
    const sz = Number(f.sz);
    const closed_pnl = Number(f.closedPnl);
    const fee = Number(f.fee);
    const hash = await sha256Hex([
      "trade",
      key,
      time,
      f.coin,
      f.dir,
      px,
      sz,
      closed_pnl,
    ]);
    rows.push({
      time,
      coin: f.coin,
      dir: f.dir as TradeDir,
      px,
      sz,
      ntl: px * sz,
      fee,
      closed_pnl,
      hash,
    });
  }
  return { rows, skippedNonPerp: skipped };
}

export async function transformFundings(
  events: HlFunding[],
  accountName: string
): Promise<ParsedFunding[]> {
  const key = accountKey(accountName);
  const rows: ParsedFunding[] = [];
  for (const e of events) {
    const time = msToCsvIsoJst(e.time);
    const szi = Number(e.delta.szi);
    const side: ParsedFunding["side"] =
      szi > 0 ? "Long" : szi < 0 ? "Short" : "";
    const payment = Number(e.delta.usdc);
    const hash = await sha256Hex([
      "funding",
      key,
      time,
      e.delta.coin,
      side,
      payment,
    ]);
    rows.push({
      time,
      coin: e.delta.coin,
      sz: Math.abs(szi),
      side,
      payment,
      rate: Number(e.delta.fundingRate),
      hash,
    });
  }
  return rows;
}

interface NormalizedLedger {
  action: string;
  source: string;
  destination: string;
  amount: number;
  fee: number;
  currency: string;
}

/**
 * Hyperliquid's ledger has many `delta.type` values. We map the common ones
 * to the same `(action, source, destination, currency)` triple that the CSV
 * export uses. Unknown types fall through with `action = delta.type` so the
 * user can still see them (and we don't lose data).
 */
function normalizeLedgerDelta(
  u: HlLedgerUpdate
): NormalizedLedger | null {
  const d = u.delta as Record<string, unknown> & { type: string };
  const num = (v: unknown): number =>
    typeof v === "number" ? v : v == null ? 0 : Number(String(v));

  switch (d.type) {
    case "deposit":
      return {
        action: "deposit",
        source: "",
        destination: "perp",
        amount: num(d.usdc),
        fee: 0,
        currency: "USDC",
      };
    case "withdraw":
      return {
        action: "withdraw",
        source: "perp",
        destination: "",
        amount: num(d.usdc),
        fee: num(d.fee),
        currency: "USDC",
      };
    case "internalTransfer":
    case "subAccountTransfer":
      return {
        action: d.type,
        source: String(d.user ?? ""),
        destination: String(d.destination ?? ""),
        amount: num(d.usdc),
        fee: num(d.fee),
        currency: "USDC",
      };
    case "accountClassTransfer":
      return {
        action: "accountClassTransfer",
        source: d.toPerp ? "spot" : "perp",
        destination: d.toPerp ? "perp" : "spot",
        amount: num(d.usdc),
        fee: 0,
        currency: "USDC",
      };
    default:
      // Catch-all for vaultDeposit/vaultWithdraw/spotTransfer/etc.
      // We preserve the type tag and any usdc amount so the row appears in
      // the UI even if we don't model its semantics.
      if (d.usdc != null) {
        return {
          action: d.type,
          source: "",
          destination: "",
          amount: num(d.usdc),
          fee: num((d as Record<string, unknown>).fee ?? 0),
          currency: "USDC",
        };
      }
      return null;
  }
}

export interface LedgerTransformResult {
  rows: ParsedTransfer[];
  /** Updates we couldn't map at all (no usdc amount, unknown shape). */
  skippedUnknown: number;
}

export async function transformLedgerUpdates(
  updates: HlLedgerUpdate[],
  accountName: string
): Promise<LedgerTransformResult> {
  const key = accountKey(accountName);
  const rows: ParsedTransfer[] = [];
  let skipped = 0;

  for (const u of updates) {
    const n = normalizeLedgerDelta(u);
    if (!n) {
      skipped++;
      continue;
    }
    const time = msToCsvIsoJst(u.time);
    const hash = await sha256Hex([
      "transfer",
      key,
      time,
      n.action,
      n.amount,
      n.currency,
    ]);
    rows.push({
      time,
      action: n.action,
      source: n.source,
      destination: n.destination,
      account_value_change: n.amount,
      fee: n.fee,
      currency: n.currency,
      hash,
    });
  }
  return { rows, skippedUnknown: skipped };
}
