import { describe, expect, it } from "vitest";
import { convertTradesToJpy } from "../conversion";
import type { TradeLike } from "../types";
import type { FxRate } from "../../fx";

function tr(
  time: string,
  closed_pnl: number,
  overrides: Partial<TradeLike> = {}
): TradeLike {
  return {
    time,
    coin: "ETH",
    dir: "Close Long",
    px: 2000,
    sz: 1,
    fee: 0.5,
    closed_pnl,
    ...overrides,
  };
}

const rates: FxRate[] = [
  { date: "2026-04-01", usd_jpy: 150 },
  { date: "2026-04-10", usd_jpy: 154 },
  { date: "2026-04-20", usd_jpy: 152 },
];

describe("convertTradesToJpy", () => {
  it("uses per-trade-date rate with carry-forward", () => {
    const trades = [
      tr("2026-04-05T12:00:00+09:00", 100), // → carry-forward 2026-04-01 (150)
      tr("2026-04-10T12:00:00+09:00", 100), // → exact 154
    ];
    const result = convertTradesToJpy(trades, rates);
    expect(result.trades[0].fx_rate).toBe(150);
    expect(result.trades[0].pnl_jpy).toBe(15000);
    expect(result.trades[1].fx_rate).toBe(154);
    expect(result.trades[1].pnl_jpy).toBe(15400);
    expect(result.missingCount).toBe(0);
  });

  it("flags trades before any rate as missing", () => {
    const trades = [tr("2026-03-01T12:00:00+09:00", 100)];
    const result = convertTradesToJpy(trades, rates);
    expect(result.trades[0].fx_rate).toBeNull();
    expect(result.trades[0].pnl_jpy).toBeNull();
    expect(result.missingCount).toBe(1);
  });

  it("returns all trades as missing when no rates are provided", () => {
    const trades = [tr("2026-04-05T12:00:00+09:00", 100)];
    const result = convertTradesToJpy(trades, []);
    expect(result.trades[0].pnl_jpy).toBeNull();
    expect(result.missingCount).toBe(1);
  });
});
