/**
 * Thin wrapper over the public Hyperliquid Info endpoint.
 *
 * The endpoint is unauthenticated, supports `*` CORS, and accepts a single
 * POST body with a `type` discriminator. We only use the three read-only
 * "user history" types needed for syncing an address.
 *
 * Endpoint docs:
 *   https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
 */

const API_URL = "https://api.hyperliquid.xyz/info";

export interface HlFill {
  coin: string;
  px: string;
  sz: string;
  side: string; // "B" (buy) or "A" (sell)
  time: number; // ms
  startPosition: string;
  dir: string; // e.g. "Open Long", "Close Short" — matches CSV's `dir`
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
  feeToken: string;
  twapId: number | null;
}

export interface HlFunding {
  time: number;
  hash: string; // observed to be 0x000…000 — do not rely on it for dedup
  delta: {
    type: "funding";
    coin: string;
    usdc: string; // signed amount in USDC: positive = received, negative = paid
    szi: string; // signed position size at the time
    fundingRate: string;
    nSamples: number | null;
  };
}

export interface HlLedgerUpdate {
  time: number;
  hash: string;
  delta: HlLedgerDelta;
}

export type HlLedgerDelta =
  | { type: "deposit"; usdc: string }
  | { type: "withdraw"; usdc: string; nonce: number; fee: string }
  | {
      type: "internalTransfer";
      usdc: string;
      user: string;
      destination: string;
      fee: string;
    }
  | { type: "accountClassTransfer"; usdc: string; toPerp: boolean }
  | {
      type: "subAccountTransfer";
      usdc: string;
      user: string;
      destination: string;
    }
  // Catch-all for vault*, spotTransfer, etc. We don't model every field but
  // we keep the type tag and any `usdc` field for display.
  | { type: string; [k: string]: unknown };

async function post<T>(body: object): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Hyperliquid API ${res.status}: ${await res.text().catch(() => "(no body)")}`
    );
  }
  return res.json() as Promise<T>;
}

/** Fetch trade fills within a time range. Max 2000 per call. */
export function fetchUserFillsByTime(
  user: string,
  startTime: number,
  endTime: number
): Promise<HlFill[]> {
  return post<HlFill[]>({ type: "userFillsByTime", user, startTime, endTime });
}

/** Fetch funding payment events in a time range. */
export function fetchUserFunding(
  user: string,
  startTime: number,
  endTime: number
): Promise<HlFunding[]> {
  return post<HlFunding[]>({ type: "userFunding", user, startTime, endTime });
}

/** Fetch deposits / withdrawals / transfers in a time range. */
export function fetchUserNonFundingLedgerUpdates(
  user: string,
  startTime: number,
  endTime: number
): Promise<HlLedgerUpdate[]> {
  return post<HlLedgerUpdate[]>({
    type: "userNonFundingLedgerUpdates",
    user,
    startTime,
    endTime,
  });
}
