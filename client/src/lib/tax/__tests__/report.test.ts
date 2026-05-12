import { describe, expect, it } from "vitest";
import { buildFxLookup } from "../../fx";
import { buildTaxReport, listAvailableYears, toCsv } from "../report";
import type { TaxTradeInput } from "../types";

function trade(
  i: number,
  overrides: Partial<TaxTradeInput> = {}
): TaxTradeInput {
  return {
    id: `t${i}`,
    accountName: "main",
    time: "2026-04-02T12:00:00+09:00",
    coin: "ETH",
    dir: "Close Long",
    px: 2000,
    sz: 1,
    fee: 0.5,
    closed_pnl: 10,
    ...overrides,
  };
}

describe("listAvailableYears", () => {
  it("returns distinct years in descending order using JST", () => {
    const trades = [
      trade(1, { time: "2026-12-31T15:00:00Z" }), // = 2027-01-01 JST
      trade(2, { time: "2026-04-02T12:00:00+09:00" }),
      trade(3, { time: "2025-12-15T12:00:00+09:00" }),
    ];
    expect(listAvailableYears(trades)).toEqual([2027, 2026, 2025]);
  });
});

describe("buildTaxReport", () => {
  const fxRates = [
    { date: "2026-04-01", usd_jpy: 150 },
    { date: "2026-04-15", usd_jpy: 151 },
  ];
  const lookup = buildFxLookup(fxRates);

  const trades: TaxTradeInput[] = [
    trade(1, {
      time: "2026-04-02T12:00:00+09:00",
      closed_pnl: 10,
    }),
    trade(2, {
      time: "2026-04-20T08:00:00+09:00",
      closed_pnl: -3,
    }),
    trade(3, {
      time: "2025-12-15T12:00:00+09:00",
      closed_pnl: 5,
    }),
  ];

  it("filters by year and applies carry-forward rates", () => {
    const report = buildTaxReport(trades, lookup, 2026);
    expect(report.rows).toHaveLength(2);

    const r1 = report.rows[0];
    expect(r1.date).toBe("2026-04-02");
    expect(r1.fx_rate).toBe(150);
    expect(r1.fx_date).toBe("2026-04-01");
    expect(r1.fx_carried_forward).toBe(true);
    expect(r1.pnl_jpy).toBeCloseTo(1500, 6);

    const r2 = report.rows[1];
    expect(r2.date).toBe("2026-04-20");
    expect(r2.fx_rate).toBe(151);
    expect(r2.pnl_jpy).toBeCloseTo(-453, 6);
  });

  it("aggregates monthly and yearly totals", () => {
    const report = buildTaxReport(trades, lookup, 2026);
    expect(report.monthlyTotals).toHaveLength(1);
    expect(report.monthlyTotals[0].month).toBe("2026-04");
    expect(report.monthlyTotals[0].pnl_jpy).toBeCloseTo(1500 - 453, 6);
    expect(report.total.rows).toBe(2);
    expect(report.total.pnl_jpy).toBeCloseTo(1500 - 453, 6);
  });

  it("flags rows whose date has no FX rate available", () => {
    const lookupEmpty = buildFxLookup([]);
    const report = buildTaxReport(trades, lookupEmpty, 2026);
    expect(report.rows.every((r) => r.fx_rate === null)).toBe(true);
    expect(report.total.missing).toBe(2);
    expect(report.total.pnl_jpy).toBe(0);
  });

  it("exposes available years for the source data (year selector)", () => {
    const report = buildTaxReport(trades, lookup, 2026);
    expect(report.availableYears).toEqual([2026, 2025]);
  });
});

describe("toCsv", () => {
  it("emits a header row and one row per trade", () => {
    const lookup = buildFxLookup([{ date: "2026-04-01", usd_jpy: 150 }]);
    const report = buildTaxReport(
      [trade(1, { time: "2026-04-02T12:00:00+09:00" })],
      lookup,
      2026
    );
    const csv = toCsv(report);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^日付,/);
    expect(lines[1]).toContain("2026-04-02");
    expect(lines[1]).toContain("ETH");
  });

  it("quotes values containing commas / newlines", () => {
    const lookup = buildFxLookup([{ date: "2026-04-01", usd_jpy: 150 }]);
    const report = buildTaxReport(
      [
        trade(1, {
          time: "2026-04-02T12:00:00+09:00",
          accountName: "my, account",
        }),
      ],
      lookup,
      2026
    );
    const csv = toCsv(report);
    expect(csv).toContain('"my, account"');
  });
});
