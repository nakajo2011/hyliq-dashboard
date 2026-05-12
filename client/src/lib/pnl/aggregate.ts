import type {
  AccountStats,
  CoinPnL,
  DailyPnLPoint,
  FundingLike,
  OpenPosition,
  TradeLike,
  TransferLike,
} from "./types";

/** Extract YYYY-MM-DD in JST (the user's reporting timezone) from an ISO string. */
export function dateKeyJst(iso: string): string {
  // ISO strings from our parser use +09:00 so slicing the first 10 chars is correct.
  // For records re-read from PocketBase the date arrives as UTC ("YYYY-MM-DD HH:..."),
  // so convert through Date to JST.
  if (iso.length >= 10 && iso[4] === "-" && iso[7] === "-" && (iso[10] === "T" || iso[10] === " ")) {
    if (iso.includes("+09:00")) return iso.slice(0, 10);
    const d = new Date(iso.replace(" ", "T"));
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().slice(0, 10);
  }
  return iso.slice(0, 10);
}

export function buildDailyPnL(trades: TradeLike[]): DailyPnLPoint[] {
  const byDate = new Map<string, number>();
  for (const t of trades) {
    const key = dateKeyJst(t.time);
    byDate.set(key, (byDate.get(key) ?? 0) + t.closed_pnl);
  }
  const sorted = Array.from(byDate.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  let cum = 0;
  return sorted.map(([date, pnl]) => {
    cum += pnl;
    return { date, pnl, cumulative: cum };
  });
}

export function buildCoinPnL(trades: TradeLike[]): CoinPnL[] {
  const m = new Map<string, CoinPnL>();
  for (const t of trades) {
    const e = m.get(t.coin) ?? {
      coin: t.coin,
      realizedPnl: 0,
      fees: 0,
      trades: 0,
    };
    e.realizedPnl += t.closed_pnl;
    e.fees += t.fee;
    e.trades += 1;
    m.set(t.coin, e);
  }
  return Array.from(m.values()).sort((a, b) => b.realizedPnl - a.realizedPnl);
}

type Lot = { sz: number; px: number };

/**
 * Compute net open positions per coin from a trade history.
 *
 * We treat each `Open <side>` as adding a lot, each `Close <side>` as
 * consuming size from the front of the FIFO queue, and `Long > Short` /
 * `Short > Long` as a full flatten of one side plus an open on the other.
 * Hyperliquid CSV doesn't disclose the split sizes for the reverse case;
 * we approximate by closing the entire remaining side then opening the new
 * side at the trade's price for the full reported size.
 */
export function buildOpenPositions(trades: TradeLike[]): OpenPosition[] {
  const sorted = [...trades].sort((a, b) => a.time.localeCompare(b.time));

  type CoinBook = { long: Lot[]; short: Lot[] };
  const books = new Map<string, CoinBook>();
  const bookOf = (coin: string): CoinBook => {
    let b = books.get(coin);
    if (!b) {
      b = { long: [], short: [] };
      books.set(coin, b);
    }
    return b;
  };

  const closeFifo = (lots: Lot[], size: number) => {
    let remaining = size;
    while (remaining > 1e-12 && lots.length > 0) {
      const head = lots[0];
      if (head.sz <= remaining + 1e-12) {
        remaining -= head.sz;
        lots.shift();
      } else {
        head.sz -= remaining;
        remaining = 0;
      }
    }
  };

  for (const t of sorted) {
    const b = bookOf(t.coin);
    switch (t.dir) {
      case "Open Long":
        b.long.push({ sz: t.sz, px: t.px });
        break;
      case "Open Short":
        b.short.push({ sz: t.sz, px: t.px });
        break;
      case "Close Long":
        closeFifo(b.long, t.sz);
        break;
      case "Close Short":
        closeFifo(b.short, t.sz);
        break;
      case "Long > Short":
        closeFifo(b.long, Infinity);
        b.short.push({ sz: t.sz, px: t.px });
        break;
      case "Short > Long":
        closeFifo(b.short, Infinity);
        b.long.push({ sz: t.sz, px: t.px });
        break;
    }
  }

  const out: OpenPosition[] = [];
  for (const [coin, book] of books) {
    const aggregate = (lots: Lot[], side: "long" | "short") => {
      const size = lots.reduce((s, l) => s + l.sz, 0);
      if (size < 1e-9) return;
      const notional = lots.reduce((s, l) => s + l.sz * l.px, 0);
      out.push({
        coin,
        side,
        size,
        avgEntry: notional / size,
        notional,
      });
    };
    aggregate(book.long, "long");
    aggregate(book.short, "short");
  }
  return out.sort(
    (a, b) => a.coin.localeCompare(b.coin) || a.side.localeCompare(b.side)
  );
}

export function buildAccountStats(
  trades: TradeLike[],
  fundings: FundingLike[],
  transfers: TransferLike[]
): AccountStats {
  let realizedPnl = 0;
  let totalFees = 0;
  for (const t of trades) {
    realizedPnl += t.closed_pnl;
    totalFees += t.fee;
  }
  let fundingNet = 0;
  for (const f of fundings) {
    // Hyperliquid funding payment: positive = received, negative = paid.
    fundingNet += f.payment;
  }
  let netDeposits = 0;
  for (const tr of transfers) {
    // Treat inbound (destination = 'trading') as positive, outbound as negative.
    // Hyperliquid CSV uses signed values in account_value_change already.
    netDeposits += tr.account_value_change;
  }
  return {
    realizedPnl,
    totalFees,
    fundingNet,
    netDeposits,
    tradeCount: trades.length,
  };
}
