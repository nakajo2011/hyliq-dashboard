import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTradeCsv, parseFundingCsv, parseTransferCsv } from "../../csv";
import {
  buildAccountStats,
  buildCoinPnL,
  buildDailyPnL,
  buildOpenPositions,
  dateKeyJst,
} from "../aggregate";
import type { TradeLike } from "../types";

const here = path.dirname(fileURLToPath(import.meta.url));
const sampleDir = path.resolve(here, "../../../../../sample_csv");

const TRADE_ADDR_1 = "0x6b94D8192eD3691a2b66c942fd1775022CbDb5b4";

function loadTrades() {
  const text = readFileSync(
    path.join(sampleDir, `trade_history_${TRADE_ADDR_1}.csv`),
    "utf8"
  );
  return parseTradeCsv(text, TRADE_ADDR_1);
}

describe("dateKeyJst", () => {
  it("returns the JST date from an ISO with +09:00 offset", () => {
    expect(dateKeyJst("2026-04-02T12:14:01+09:00")).toBe("2026-04-02");
  });

  it("converts UTC timestamps from PocketBase to JST date", () => {
    // 2026-04-12 14:51:13 UTC = 2026-04-12 23:51:13 JST → same day
    expect(dateKeyJst("2026-04-12 14:51:13.000Z")).toBe("2026-04-12");
    // 2026-04-11 22:51:13 UTC = 2026-04-12 07:51:13 JST → next day
    expect(dateKeyJst("2026-04-11 22:51:13.000Z")).toBe("2026-04-12");
  });
});

describe("buildDailyPnL", () => {
  it("sums closed_pnl per JST date and computes running cumulative", async () => {
    const parsed = await loadTrades();
    const daily = buildDailyPnL(parsed.rows);
    // Dates should be unique and sorted ascending
    const dates = daily.map((d) => d.date);
    expect(dates).toEqual([...dates].sort());
    // Cumulative on the last point equals sum of all closed_pnl
    const total = parsed.rows.reduce((s, r) => s + r.closed_pnl, 0);
    expect(daily.at(-1)!.cumulative).toBeCloseTo(total, 6);
  });

  it("returns empty array for no trades", () => {
    expect(buildDailyPnL([])).toEqual([]);
  });
});

describe("buildCoinPnL", () => {
  it("groups by coin and sorts by realizedPnl desc", async () => {
    const parsed = await loadTrades();
    const coins = buildCoinPnL(parsed.rows);
    expect(coins.length).toBeGreaterThan(0);
    // sorted descending
    for (let i = 1; i < coins.length; i++) {
      expect(coins[i - 1].realizedPnl).toBeGreaterThanOrEqual(
        coins[i].realizedPnl
      );
    }
    // every trade counted once
    const totalTrades = coins.reduce((s, c) => s + c.trades, 0);
    expect(totalTrades).toBe(parsed.rows.length);
  });
});

describe("buildOpenPositions", () => {
  it("returns no open position when all positions are closed", () => {
    // Open and close the same size → flat
    const trades: TradeLike[] = [
      {
        time: "2026-04-01T10:00:00+09:00",
        coin: "ETH",
        dir: "Open Long",
        px: 2000,
        sz: 1,
        fee: 0,
        closed_pnl: 0,
      },
      {
        time: "2026-04-01T11:00:00+09:00",
        coin: "ETH",
        dir: "Close Long",
        px: 2100,
        sz: 1,
        fee: 0,
        closed_pnl: 100,
      },
    ];
    expect(buildOpenPositions(trades)).toEqual([]);
  });

  it("computes weighted average entry across multiple opens", () => {
    const trades: TradeLike[] = [
      {
        time: "2026-04-01T10:00:00+09:00",
        coin: "ETH",
        dir: "Open Long",
        px: 2000,
        sz: 1,
        fee: 0,
        closed_pnl: 0,
      },
      {
        time: "2026-04-01T11:00:00+09:00",
        coin: "ETH",
        dir: "Open Long",
        px: 2200,
        sz: 2,
        fee: 0,
        closed_pnl: 0,
      },
    ];
    const positions = buildOpenPositions(trades);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      coin: "ETH",
      side: "long",
      size: 3,
    });
    // weighted: (2000*1 + 2200*2) / 3 = 6400/3
    expect(positions[0].avgEntry).toBeCloseTo(6400 / 3, 6);
  });

  it("FIFO closes the oldest lot first", () => {
    const trades: TradeLike[] = [
      {
        time: "2026-04-01T10:00:00+09:00",
        coin: "ETH",
        dir: "Open Long",
        px: 2000,
        sz: 1,
        fee: 0,
        closed_pnl: 0,
      },
      {
        time: "2026-04-01T11:00:00+09:00",
        coin: "ETH",
        dir: "Open Long",
        px: 2200,
        sz: 2,
        fee: 0,
        closed_pnl: 0,
      },
      {
        time: "2026-04-01T12:00:00+09:00",
        coin: "ETH",
        dir: "Close Long",
        px: 2100,
        sz: 1,
        fee: 0,
        closed_pnl: 100,
      },
    ];
    const positions = buildOpenPositions(trades);
    expect(positions).toHaveLength(1);
    // Remaining is 2 @ 2200
    expect(positions[0].size).toBeCloseTo(2, 6);
    expect(positions[0].avgEntry).toBeCloseTo(2200, 6);
  });

  it("handles Long > Short by flattening longs and opening short", () => {
    const trades: TradeLike[] = [
      {
        time: "2026-04-01T10:00:00+09:00",
        coin: "ETH",
        dir: "Open Long",
        px: 2000,
        sz: 1,
        fee: 0,
        closed_pnl: 0,
      },
      {
        time: "2026-04-01T11:00:00+09:00",
        coin: "ETH",
        dir: "Long > Short",
        px: 2050,
        sz: 0.5,
        fee: 0,
        closed_pnl: 50,
      },
    ];
    const positions = buildOpenPositions(trades);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      coin: "ETH",
      side: "short",
      size: 0.5,
      avgEntry: 2050,
    });
  });
});

describe("buildAccountStats", () => {
  it("aggregates trades/fundings/transfers totals", async () => {
    const tradeText = readFileSync(
      path.join(sampleDir, `trade_history_${TRADE_ADDR_1}.csv`),
      "utf8"
    );
    const fundingText = readFileSync(
      path.join(sampleDir, "funding_history.csv"),
      "utf8"
    );
    const transferText = readFileSync(
      path.join(sampleDir, "deposits_and_withdrawals.csv"),
      "utf8"
    );
    const trades = await parseTradeCsv(tradeText, TRADE_ADDR_1);
    const fundings = await parseFundingCsv(fundingText, TRADE_ADDR_1);
    const transfers = await parseTransferCsv(transferText, TRADE_ADDR_1);

    const stats = buildAccountStats(trades.rows, fundings.rows, transfers.rows);
    expect(stats.tradeCount).toBe(12);
    expect(stats.realizedPnl).toBeCloseTo(
      trades.rows.reduce((s, t) => s + t.closed_pnl, 0),
      6
    );
    expect(stats.totalFees).toBeCloseTo(
      trades.rows.reduce((s, t) => s + t.fee, 0),
      6
    );
    expect(stats.fundingNet).toBeCloseTo(
      fundings.rows.reduce((s, f) => s + f.payment, 0),
      6
    );
    expect(stats.netDeposits).toBeCloseTo(
      transfers.rows.reduce((s, t) => s + t.account_value_change, 0),
      6
    );
  });
});
