import { dateKeyJst } from "../pnl";
import type { FxLookup } from "../fx";
import type {
  MonthlyTotal,
  TaxReport,
  TaxReportRow,
  TaxTradeInput,
} from "./types";

export function listAvailableYears(trades: TaxTradeInput[]): number[] {
  const set = new Set<number>();
  for (const t of trades) {
    set.add(Number(dateKeyJst(t.time).slice(0, 4)));
  }
  return Array.from(set).sort((a, b) => b - a);
}

/**
 * Build a tax report for a given year.
 *
 * Every trade row (including Open rows where closed_pnl is just -fee) is
 * included so the JPY-equivalent picture matches Hyperliquid's PnL accounting.
 * Each row's PnL is converted to JPY using the FX rate of its trade date in
 * JST (carry-forward on weekends/holidays).
 */
export function buildTaxReport(
  trades: TaxTradeInput[],
  fxLookup: FxLookup,
  year: number
): TaxReport {
  const availableYears = listAvailableYears(trades);

  const yearTrades = trades
    .filter((t) => Number(dateKeyJst(t.time).slice(0, 4)) === year)
    .sort((a, b) => a.time.localeCompare(b.time));

  const rows: TaxReportRow[] = yearTrades.map((t) => {
    const date = dateKeyJst(t.time);
    const fx = fxLookup(date);
    const pnl_usd = t.closed_pnl;
    return {
      tradeId: t.id,
      accountName: t.accountName,
      date,
      coin: t.coin,
      dir: t.dir,
      px: t.px,
      sz: t.sz,
      pnl_usd,
      fee_usd: t.fee,
      fx_rate: fx?.rate ?? null,
      fx_date: fx?.fxDate ?? null,
      fx_carried_forward: fx?.carriedForward ?? false,
      pnl_jpy: fx ? pnl_usd * fx.rate : null,
    };
  });

  const byMonth = new Map<string, MonthlyTotal>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const m = byMonth.get(month) ?? {
      month,
      rows: 0,
      pnl_usd: 0,
      pnl_jpy: 0,
      missing: 0,
    };
    m.rows += 1;
    m.pnl_usd += r.pnl_usd;
    if (r.pnl_jpy != null) m.pnl_jpy += r.pnl_jpy;
    else m.missing += 1;
    byMonth.set(month, m);
  }
  const monthlyTotals = Array.from(byMonth.values()).sort((a, b) =>
    a.month.localeCompare(b.month)
  );

  const total = monthlyTotals.reduce(
    (acc, m) => {
      acc.rows += m.rows;
      acc.pnl_usd += m.pnl_usd;
      acc.pnl_jpy += m.pnl_jpy;
      acc.missing += m.missing;
      return acc;
    },
    { rows: 0, pnl_usd: 0, pnl_jpy: 0, missing: 0 }
  );

  return {
    year,
    rows,
    monthlyTotals,
    total,
    availableYears,
  };
}

/** Convert a report into CSV text for download / 会計ソフト 取り込み. */
export function toCsv(report: TaxReport): string {
  const header = [
    "日付",
    "アカウント",
    "通貨",
    "方向",
    "数量",
    "価格",
    "実現PnL(USD)",
    "手数料(USD)",
    "USD/JPY",
    "為替日付",
    "Carry-forward",
    "実現PnL(JPY)",
  ];

  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines = [header.join(",")];
  for (const r of report.rows) {
    lines.push(
      [
        r.date,
        r.accountName,
        r.coin,
        r.dir,
        r.sz,
        r.px,
        r.pnl_usd.toFixed(8),
        r.fee_usd.toFixed(8),
        r.fx_rate ?? "",
        r.fx_date ?? "",
        r.fx_carried_forward ? "1" : "",
        r.pnl_jpy != null ? r.pnl_jpy.toFixed(4) : "",
      ]
        .map(escape)
        .join(",")
    );
  }
  return lines.join("\n");
}
