import { dateKeyJst } from "../pnl";
import type { FxLookup } from "../fx";
import type {
  KindSummary,
  MonthlyTotal,
  TaxFundingInput,
  TaxReport,
  TaxReportRow,
  TaxTradeInput,
  TaxTransferInput,
  TotalSummary,
} from "./types";

function emptySummary(): KindSummary {
  return { rows: 0, amount_usd: 0, amount_jpy: 0 };
}

function emptyMonthly(month: string): MonthlyTotal {
  return {
    month,
    trade: emptySummary(),
    funding: emptySummary(),
    transfer: emptySummary(),
    total: emptySummary(),
    missing: 0,
  };
}

function emptyTotal(): TotalSummary {
  return {
    rows: 0,
    amount_usd: 0,
    amount_jpy: 0,
    trade: emptySummary(),
    funding: emptySummary(),
    transfer: emptySummary(),
    missing: 0,
  };
}

export function listAvailableYears(
  trades: TaxTradeInput[],
  fundings: TaxFundingInput[] = [],
  transfers: TaxTransferInput[] = []
): number[] {
  const set = new Set<number>();
  for (const t of trades) set.add(Number(dateKeyJst(t.time).slice(0, 4)));
  for (const f of fundings) set.add(Number(dateKeyJst(f.time).slice(0, 4)));
  for (const tr of transfers) set.add(Number(dateKeyJst(tr.time).slice(0, 4)));
  return Array.from(set).sort((a, b) => b - a);
}

/**
 * Build a tax report for a given year.
 *
 * Sources:
 *   - trades:    every trade row × trade-date USD/JPY → "trade" rows
 *   - fundings:  every funding row × that-day rate → "funding" rows
 *                (in Japan, perp funding is always 雑所得 — no per-row toggle)
 *   - transfers: only `taxable === true` rows are included (the user marks
 *                deposits that are actually income on the Account Detail page)
 *
 * The user picks the year; only rows whose JST date is in that year appear.
 */
export function buildTaxReport(
  trades: TaxTradeInput[],
  fundings: TaxFundingInput[],
  transfers: TaxTransferInput[],
  fxLookup: FxLookup,
  year: number
): TaxReport {
  const availableYears = listAvailableYears(trades, fundings, transfers);

  const tradeRows: TaxReportRow[] = trades
    .filter((t) => Number(dateKeyJst(t.time).slice(0, 4)) === year)
    .map((t) => {
      const date = dateKeyJst(t.time);
      const fx = fxLookup(date);
      const amount = t.closed_pnl;
      return {
        kind: "trade",
        id: t.id,
        accountName: t.accountName,
        date,
        description: `${t.dir} ${t.coin}`,
        coin: t.coin,
        dir: t.dir,
        px: t.px,
        sz: t.sz,
        amount_usd: amount,
        fee_usd: t.fee,
        fx_rate: fx?.rate ?? null,
        fx_date: fx?.fxDate ?? null,
        fx_carried_forward: fx?.carriedForward ?? false,
        amount_jpy: fx ? amount * fx.rate : null,
      };
    });

  const fundingRows: TaxReportRow[] = fundings
    .filter((f) => Number(dateKeyJst(f.time).slice(0, 4)) === year)
    .map((f) => {
      const date = dateKeyJst(f.time);
      const fx = fxLookup(date);
      const amount = f.payment;
      return {
        kind: "funding",
        id: f.id,
        accountName: f.accountName,
        date,
        description: `Funding ${f.coin}${f.side ? ` (${f.side})` : ""}`,
        coin: f.coin,
        dir: "",
        px: 0,
        sz: 0,
        amount_usd: amount,
        fee_usd: 0,
        fx_rate: fx?.rate ?? null,
        fx_date: fx?.fxDate ?? null,
        fx_carried_forward: fx?.carriedForward ?? false,
        amount_jpy: fx ? amount * fx.rate : null,
      };
    });

  const transferRows: TaxReportRow[] = transfers
    .filter(
      (tr) =>
        tr.taxable && Number(dateKeyJst(tr.time).slice(0, 4)) === year
    )
    .map((tr) => {
      const date = dateKeyJst(tr.time);
      const fx = fxLookup(date);
      const amount = tr.account_value_change;
      return {
        kind: "transfer",
        id: tr.id,
        accountName: tr.accountName,
        date,
        description: `${tr.action} ${tr.currency} (${tr.source}→${tr.destination})`,
        coin: tr.currency,
        dir: "",
        px: 0,
        sz: 0,
        amount_usd: amount,
        fee_usd: tr.fee,
        fx_rate: fx?.rate ?? null,
        fx_date: fx?.fxDate ?? null,
        fx_carried_forward: fx?.carriedForward ?? false,
        amount_jpy: fx ? amount * fx.rate : null,
      };
    });

  const rows = [...tradeRows, ...fundingRows, ...transferRows].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const byMonth = new Map<string, MonthlyTotal>();
  const total = emptyTotal();

  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const m = byMonth.get(month) ?? emptyMonthly(month);
    const bucket = m[r.kind];
    bucket.rows += 1;
    bucket.amount_usd += r.amount_usd;
    if (r.amount_jpy != null) bucket.amount_jpy += r.amount_jpy;
    m.total.rows += 1;
    m.total.amount_usd += r.amount_usd;
    if (r.amount_jpy != null) m.total.amount_jpy += r.amount_jpy;
    if (r.amount_jpy == null) m.missing += 1;
    byMonth.set(month, m);

    const tBucket = total[r.kind];
    tBucket.rows += 1;
    tBucket.amount_usd += r.amount_usd;
    if (r.amount_jpy != null) tBucket.amount_jpy += r.amount_jpy;
    total.rows += 1;
    total.amount_usd += r.amount_usd;
    if (r.amount_jpy != null) total.amount_jpy += r.amount_jpy;
    if (r.amount_jpy == null) total.missing += 1;
  }

  const monthlyTotals = Array.from(byMonth.values()).sort((a, b) =>
    a.month.localeCompare(b.month)
  );

  return { year, rows, monthlyTotals, total, availableYears };
}

const KIND_LABEL_JA: Record<TaxReportRow["kind"], string> = {
  trade: "取引",
  funding: "ファンディング",
  transfer: "その他収入",
};

/** Convert a report into CSV text for download / 会計ソフト 取り込み. */
export function toCsv(report: TaxReport): string {
  const header = [
    "種別",
    "日付",
    "アカウント",
    "内容",
    "数量",
    "価格",
    "金額(USD)",
    "手数料(USD)",
    "USD/JPY",
    "為替日付",
    "Carry-forward",
    "金額(JPY)",
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
        KIND_LABEL_JA[r.kind],
        r.date,
        r.accountName,
        r.description,
        r.kind === "trade" ? r.sz : "",
        r.kind === "trade" ? r.px : "",
        r.amount_usd.toFixed(8),
        r.fee_usd ? r.fee_usd.toFixed(8) : "",
        r.fx_rate ?? "",
        r.fx_date ?? "",
        r.fx_carried_forward ? "1" : "",
        r.amount_jpy != null ? r.amount_jpy.toFixed(4) : "",
      ]
        .map(escape)
        .join(",")
    );
  }
  return lines.join("\n");
}
