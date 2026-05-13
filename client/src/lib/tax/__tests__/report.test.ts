import { describe, expect, it } from "vitest";
import { buildFxLookup } from "../../fx";
import { buildTaxReport, listAvailableYears, toCsv } from "../report";
import type {
  TaxFundingInput,
  TaxTradeInput,
  TaxTransferInput,
} from "../types";

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

function funding(
  i: number,
  overrides: Partial<TaxFundingInput> = {}
): TaxFundingInput {
  return {
    id: `f${i}`,
    accountName: "main",
    time: "2026-04-02T12:00:00+09:00",
    coin: "ETH",
    side: "Long",
    payment: 1.5,
    ...overrides,
  };
}

function xfer(
  i: number,
  overrides: Partial<TaxTransferInput> = {}
): TaxTransferInput {
  return {
    id: `x${i}`,
    accountName: "main",
    time: "2026-04-02T12:00:00+09:00",
    action: "send",
    source: "trading",
    destination: "trading",
    account_value_change: 100,
    fee: 0,
    currency: "USDC",
    taxable: false,
    ...overrides,
  };
}

const rates = [
  { date: "2026-04-01", usd_jpy: 150 },
  { date: "2026-04-15", usd_jpy: 151 },
];
const lookup = buildFxLookup(rates);

describe("listAvailableYears", () => {
  it("returns distinct years across trades / fundings / transfers", () => {
    const years = listAvailableYears(
      [trade(1, { time: "2026-04-02T12:00:00+09:00" })],
      [funding(1, { time: "2025-12-15T12:00:00+09:00" })],
      [xfer(1, { time: "2024-06-01T12:00:00+09:00" })]
    );
    expect(years).toEqual([2026, 2025, 2024]);
  });
});

describe("buildTaxReport — trades only", () => {
  it("filters by year and produces trade rows with daily rate", () => {
    const trades = [
      trade(1, { time: "2026-04-02T12:00:00+09:00", closed_pnl: 10 }),
      trade(2, { time: "2026-04-20T08:00:00+09:00", closed_pnl: -3 }),
      trade(3, { time: "2025-12-15T12:00:00+09:00", closed_pnl: 5 }),
    ];
    const report = buildTaxReport(trades, [], [], lookup, 2026);
    expect(report.rows).toHaveLength(2);
    expect(report.rows.every((r) => r.kind === "trade")).toBe(true);
    expect(report.total.trade.rows).toBe(2);
    expect(report.total.trade.amount_jpy).toBeCloseTo(1500 - 453, 6);
    expect(report.total.amount_jpy).toBeCloseTo(1500 - 453, 6);
  });
});

describe("buildTaxReport — funding is always taxable", () => {
  it("includes every funding row in the year regardless of side", () => {
    const fundings = [
      funding(1, { time: "2026-04-02T12:00:00+09:00", payment: 2 }),
      funding(2, { time: "2026-04-20T12:00:00+09:00", payment: -1 }),
    ];
    const report = buildTaxReport([], fundings, [], lookup, 2026);
    expect(report.rows.filter((r) => r.kind === "funding")).toHaveLength(2);
    expect(report.total.funding.amount_jpy).toBeCloseTo(
      2 * 150 + -1 * 151,
      6
    );
  });
});

describe("buildTaxReport — only taxable transfers", () => {
  it("excludes non-taxable transfers", () => {
    const transfers = [
      xfer(1, {
        time: "2026-04-02T12:00:00+09:00",
        account_value_change: 100,
        taxable: false,
      }),
      xfer(2, {
        time: "2026-04-20T12:00:00+09:00",
        account_value_change: 50,
        taxable: true,
      }),
    ];
    const report = buildTaxReport([], [], transfers, lookup, 2026);
    expect(report.rows.filter((r) => r.kind === "transfer")).toHaveLength(1);
    expect(report.rows[0].id).toBe("x2");
    expect(report.total.transfer.amount_jpy).toBeCloseTo(50 * 151, 6);
  });
});

describe("buildTaxReport — combined", () => {
  it("aggregates 3 kinds into one report with per-kind monthly totals", () => {
    const trades = [
      trade(1, { time: "2026-04-02T12:00:00+09:00", closed_pnl: 10 }),
    ];
    const fundings = [
      funding(1, { time: "2026-04-02T15:00:00+09:00", payment: 2 }),
    ];
    const transfers = [
      xfer(1, {
        time: "2026-04-02T18:00:00+09:00",
        account_value_change: 100,
        taxable: true,
      }),
    ];
    const report = buildTaxReport(trades, fundings, transfers, lookup, 2026);
    expect(report.rows).toHaveLength(3);
    expect(report.total.rows).toBe(3);
    expect(report.monthlyTotals).toHaveLength(1);
    const apr = report.monthlyTotals[0];
    expect(apr.month).toBe("2026-04");
    expect(apr.trade.rows).toBe(1);
    expect(apr.funding.rows).toBe(1);
    expect(apr.transfer.rows).toBe(1);
    expect(apr.total.rows).toBe(3);
    expect(apr.total.amount_jpy).toBeCloseTo(
      10 * 150 + 2 * 150 + 100 * 150,
      6
    );
  });
});

describe("buildTaxReport — missing rates", () => {
  it("flags rows whose date has no FX rate available", () => {
    const lookupEmpty = buildFxLookup([]);
    const trades = [
      trade(1, { time: "2026-04-02T12:00:00+09:00", closed_pnl: 10 }),
    ];
    const report = buildTaxReport(trades, [], [], lookupEmpty, 2026);
    expect(report.rows[0].amount_jpy).toBeNull();
    expect(report.total.missing).toBe(1);
  });
});

describe("toCsv", () => {
  it("emits a header row and one row per record across 3 kinds", () => {
    const report = buildTaxReport(
      [trade(1, { time: "2026-04-02T12:00:00+09:00" })],
      [funding(1, { time: "2026-04-02T15:00:00+09:00", payment: 2 })],
      [
        xfer(1, {
          time: "2026-04-02T18:00:00+09:00",
          account_value_change: 100,
          taxable: true,
        }),
      ],
      lookup,
      2026
    );
    const csv = toCsv(report);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^種別,/);
    expect(lines.some((l) => l.startsWith("取引,"))).toBe(true);
    expect(lines.some((l) => l.startsWith("ファンディング,"))).toBe(true);
    expect(lines.some((l) => l.startsWith("その他収入,"))).toBe(true);
  });
});
