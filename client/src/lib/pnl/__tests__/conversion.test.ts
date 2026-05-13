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

describe("convertTradesToJpy / daily", () => {
  it("uses per-trade-date rate with carry-forward", () => {
    const trades = [
      tr("2026-04-05T12:00:00+09:00", 100), // → carry-forward 2026-04-01 (150)
      tr("2026-04-10T12:00:00+09:00", 100), // → exact 154
    ];
    const result = convertTradesToJpy(trades, rates, "daily");
    expect(result.trades[0].fx_rate).toBe(150);
    expect(result.trades[0].pnl_jpy).toBe(15000);
    expect(result.trades[1].fx_rate).toBe(154);
    expect(result.trades[1].pnl_jpy).toBe(15400);
    expect(result.missingCount).toBe(0);
  });

  it("flags trades before any rate as missing", () => {
    const trades = [tr("2026-03-01T12:00:00+09:00", 100)];
    const result = convertTradesToJpy(trades, rates, "daily");
    expect(result.trades[0].fx_rate).toBeNull();
    expect(result.trades[0].pnl_jpy).toBeNull();
    expect(result.missingCount).toBe(1);
  });
});

describe("convertTradesToJpy / total-average", () => {
  it("applies the average of all rates to every trade", () => {
    const trades = [
      tr("2026-04-05T12:00:00+09:00", 100),
      tr("2026-04-15T12:00:00+09:00", 50),
    ];
    const result = convertTradesToJpy(trades, rates, "total-average");
    const avg = (150 + 154 + 152) / 3; // 152
    expect(result.effectiveRate).toBeCloseTo(avg, 6);
    expect(result.trades[0].fx_rate).toBeCloseTo(avg, 6);
    expect(result.trades[0].pnl_jpy).toBeCloseTo(100 * avg, 6);
    expect(result.trades[1].pnl_jpy).toBeCloseTo(50 * avg, 6);
    expect(result.missingCount).toBe(0);
  });

  it("marks all trades as missing when no rates are provided", () => {
    const trades = [tr("2026-04-05T12:00:00+09:00", 100)];
    const result = convertTradesToJpy(trades, [], "total-average");
    expect(result.trades[0].pnl_jpy).toBeNull();
    expect(result.missingCount).toBe(1);
    expect(result.effectiveRate).toBeUndefined();
  });
});

describe("convertTradesToJpy / moving-average", () => {
  it("uses cumulative average of rates up to each trade date", () => {
    const trades = [
      tr("2026-04-05T12:00:00+09:00", 100), // only 04-01 known → avg 150
      tr("2026-04-15T12:00:00+09:00", 100), // 04-01 + 04-10 → avg 152
      tr("2026-04-25T12:00:00+09:00", 100), // all three → avg 152
    ];
    const result = convertTradesToJpy(trades, rates, "moving-average");
    expect(result.trades[0].fx_rate).toBeCloseTo(150, 6);
    expect(result.trades[1].fx_rate).toBeCloseTo(152, 6);
    expect(result.trades[2].fx_rate).toBeCloseTo(152, 6);
    expect(result.trades[0].pnl_jpy).toBeCloseTo(15000, 6);
    expect(result.trades[1].pnl_jpy).toBeCloseTo(15200, 6);
    expect(result.trades[2].pnl_jpy).toBeCloseTo(15200, 6);
    expect(result.missingCount).toBe(0);
  });

  it("flags trades before any rate as missing", () => {
    const trades = [tr("2026-03-15T12:00:00+09:00", 100)];
    const result = convertTradesToJpy(trades, rates, "moving-average");
    expect(result.trades[0].fx_rate).toBeNull();
    expect(result.missingCount).toBe(1);
  });

  it("handles unsorted rate input", () => {
    const shuffled = [rates[2], rates[0], rates[1]];
    const trades = [tr("2026-04-25T12:00:00+09:00", 100)];
    const result = convertTradesToJpy(trades, shuffled, "moving-average");
    expect(result.trades[0].fx_rate).toBeCloseTo(152, 6);
  });
});
