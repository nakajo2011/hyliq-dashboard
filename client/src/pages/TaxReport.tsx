import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { pb } from "../lib/pb";
import {
  btnDisabled,
  btnPrimary,
  COLORS,
  h2,
  table,
  td,
  tdRight,
  tdRightHead,
  th,
  trHead,
  trRow,
} from "../styles";
import { buildFxLookup, upsertFxRate, type FxRate } from "../lib/fx";
import {
  buildTaxReport,
  listAvailableYears,
  toCsv,
  type TaxFundingInput,
  type TaxReport,
  type TaxTradeInput,
  type TaxTransferInput,
} from "../lib/tax";
import { dateKeyJst, type TradeLike } from "../lib/pnl";

type TradeRecord = TradeLike & { id: string; account: string };
type FundingRecord = {
  id: string;
  account: string;
  time: string;
  coin: string;
  side: string;
  payment: number;
};
type TransferRecord = {
  id: string;
  account: string;
  time: string;
  action: string;
  source: string;
  destination: string;
  account_value_change: number;
  fee: number;
  currency: string;
  taxable: boolean;
};
type AccountRecord = { id: string; name: string };
type FxRecord = FxRate & { id: string };

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      trades: TaxTradeInput[];
      fundings: TaxFundingInput[];
      transfers: TaxTransferInput[];
      fxRates: FxRate[];
    };

export function TaxReport() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [accounts, trades, fundings, transfers, fxRows] =
          await Promise.all([
            pb.collection("accounts").getFullList<AccountRecord>(),
            pb
              .collection("trades")
              .getFullList<TradeRecord>({ sort: "+time" }),
            pb
              .collection("fundings")
              .getFullList<FundingRecord>({ sort: "+time" }),
            pb
              .collection("transfers")
              .getFullList<TransferRecord>({ sort: "+time" }),
            pb.collection("fx_rates").getFullList<FxRecord>(),
          ]);
        if (cancelled) return;
        const accountById = new Map(accounts.map((a) => [a.id, a.name]));
        const named = (id: string) =>
          accountById.get(id) ?? "(unknown)";
        const enrichedTrades: TaxTradeInput[] = trades.map((t) => ({
          id: t.id,
          accountName: named(t.account),
          time: t.time,
          coin: t.coin,
          dir: t.dir,
          px: t.px,
          sz: t.sz,
          fee: t.fee,
          closed_pnl: t.closed_pnl,
        }));
        const enrichedFundings: TaxFundingInput[] = fundings.map((f) => ({
          id: f.id,
          accountName: named(f.account),
          time: f.time,
          coin: f.coin,
          side: f.side,
          payment: f.payment,
        }));
        const enrichedTransfers: TaxTransferInput[] = transfers.map((tr) => ({
          id: tr.id,
          accountName: named(tr.account),
          time: tr.time,
          action: tr.action,
          source: tr.source,
          destination: tr.destination,
          account_value_change: tr.account_value_change,
          fee: tr.fee,
          currency: tr.currency,
          taxable: tr.taxable,
        }));
        const fxRates: FxRate[] = fxRows.map((r) => ({
          date: r.date.slice(0, 10),
          usd_jpy: r.usd_jpy,
        }));
        setState({
          status: "ready",
          trades: enrichedTrades,
          fundings: enrichedFundings,
          transfers: enrichedTransfers,
          fxRates,
        });
      } catch (e) {
        if (!cancelled) {
          setState({
            status: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pick default year (latest with data) once the data loads.
  useEffect(() => {
    if (state.status === "ready" && year === null) {
      const years = listAvailableYears(
        state.trades,
        state.fundings,
        state.transfers
      );
      if (years.length > 0) setYear(years[0]);
    }
  }, [state, year]);

  if (state.status === "loading") return <p>読み込み中...</p>;
  if (state.status === "error")
    return <p style={{ color: "#ff6b6b" }}>❌ {state.message}</p>;

  const availableYears = listAvailableYears(
    state.trades,
    state.fundings,
    state.transfers
  );
  if (availableYears.length === 0) {
    return (
      <div>
        <h1 style={{ marginTop: 0 }}>確定申告レポート</h1>
        <p style={{ color: "#888" }}>
          まだ取引データがありません。<Link to="/upload">Upload</Link> から CSV を取り込んでください。
        </p>
      </div>
    );
  }

  const activeYear = year ?? availableYears[0];

  const reloadFxRates = async () => {
    const fxRows = await pb.collection("fx_rates").getFullList<FxRecord>();
    const fxRates: FxRate[] = fxRows.map((r) => ({
      date: r.date.slice(0, 10),
      usd_jpy: r.usd_jpy,
    }));
    setState((prev) =>
      prev.status === "ready" ? { ...prev, fxRates } : prev
    );
  };

  const handleToggleTaxable = async (
    transferId: string,
    taxable: boolean
  ) => {
    try {
      await pb.collection("transfers").update(transferId, { taxable });
    } catch (e) {
      alert(
        "更新失敗: " + (e instanceof Error ? e.message : String(e))
      );
      return;
    }
    setState((prev) => {
      if (prev.status !== "ready") return prev;
      return {
        ...prev,
        transfers: prev.transfers.map((t) =>
          t.id === transferId ? { ...t, taxable } : t
        ),
      };
    });
  };

  return (
    <ReportView
      year={activeYear}
      availableYears={availableYears}
      onChangeYear={setYear}
      trades={state.trades}
      fundings={state.fundings}
      transfers={state.transfers}
      fxRates={state.fxRates}
      onFxChanged={reloadFxRates}
      onToggleTaxable={handleToggleTaxable}
    />
  );
}

function ReportView({
  year,
  availableYears,
  onChangeYear,
  trades,
  fundings,
  transfers,
  fxRates,
  onFxChanged,
  onToggleTaxable,
}: {
  year: number;
  availableYears: number[];
  onChangeYear: (y: number) => void;
  trades: TaxTradeInput[];
  fundings: TaxFundingInput[];
  transfers: TaxTransferInput[];
  fxRates: FxRate[];
  onFxChanged: () => Promise<void>;
  onToggleTaxable: (transferId: string, taxable: boolean) => Promise<void>;
}) {
  const lookup = useMemo(() => buildFxLookup(fxRates), [fxRates]);
  const report = useMemo(
    () => buildTaxReport(trades, fundings, transfers, lookup, year),
    [trades, fundings, transfers, lookup, year]
  );

  // Filter raw arrays by year for the per-kind detail tables. (The report
  // above only contains taxable transfers — we want to show ALL transfers
  // here so the user can toggle taxable per row.)
  const yearTrades = useMemo(
    () =>
      trades
        .filter((t) => Number(dateKeyJst(t.time).slice(0, 4)) === year)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [trades, year]
  );
  const yearFundings = useMemo(
    () =>
      fundings
        .filter((f) => Number(dateKeyJst(f.time).slice(0, 4)) === year)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [fundings, year]
  );
  const yearTransfers = useMemo(
    () =>
      transfers
        .filter((t) => Number(dateKeyJst(t.time).slice(0, 4)) === year)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [transfers, year]
  );

  // Per-section pagination. Reset to page 1 when the selected year changes.
  const tradePaging = usePagination(yearTrades, year);
  const fundingPaging = usePagination(yearFundings, year);
  const transferPaging = usePagination(yearTransfers, year);

  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = (date: string, current: number | null) => {
    setEditingDate(date);
    setEditValue(current != null ? current.toFixed(3) : "");
  };
  const cancelEdit = () => {
    setEditingDate(null);
    setEditValue("");
  };
  const saveEdit = async () => {
    if (!editingDate) return;
    const value = Number(editValue);
    if (!isFinite(value) || value <= 0) {
      alert("レートが不正です");
      return;
    }
    setSaving(true);
    try {
      await upsertFxRate(editingDate, value);
      await onFxChanged();
      cancelEdit();
    } catch (e) {
      alert(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const csv = toCsv(report);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tax_report_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>確定申告レポート</h1>
      <p style={{ color: "#888" }}>
        年度ごとの取引を当日 USD/JPY で円換算します。為替レートは{" "}
        <Link to="/fx" style={{ color: "#6cf" }}>
          FX
        </Link>{" "}
        ページで登録してください。
      </p>

      <div
        style={{
          display: "flex",
          gap: "1rem",
          alignItems: "center",
          marginTop: "1rem",
          flexWrap: "wrap",
        }}
      >
        <label style={{ fontSize: "0.9rem", color: "#aab" }}>
          対象年度{" "}
          <select
            value={year}
            onChange={(e) => onChangeYear(Number(e.target.value))}
            style={selectStyle}
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleExport}
          disabled={report.rows.length === 0}
          style={
            report.rows.length === 0 ? btnDisabled : btnPrimary
          }
        >
          CSV エクスポート
        </button>
      </div>

      <Kpis report={report} />

      {report.total.missing > 0 && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.8rem 1rem",
            background: "#3b2f1d",
            border: "1px solid #6b522a",
            borderRadius: 8,
            color: "#f5d678",
          }}
        >
          ⚠️ {report.total.missing} 件の取引が為替レート未登録です。
          <Link to="/fx" style={{ color: "#6cf", marginLeft: 6 }}>
            /fx で登録
          </Link>
        </div>
      )}

      <section style={section}>
        <h2 style={h2}>月別合計 (JPY、種別別)</h2>
        {report.monthlyTotals.length === 0 ? (
          <p style={{ color: "#666" }}>この年度に対象データはありません</p>
        ) : (
          <table style={table}>
            <thead>
              <tr style={trHead}>
                <th style={th}>月</th>
                <th style={tdRightHead}>取引</th>
                <th style={tdRightHead}>ファンディング</th>
                <th style={tdRightHead}>その他収入</th>
                <th style={tdRightHead}>合計</th>
                <th style={tdRightHead}>レート欠損</th>
              </tr>
            </thead>
            <tbody>
              {report.monthlyTotals.map((m) => (
                <tr key={m.month} style={trRow}>
                  <td style={td}>{m.month}</td>
                  <td style={{ ...tdRight, color: m.trade.amount_jpy >= 0 ? "#5dd58c" : "#ff8c8c" }}>
                    {m.trade.amount_jpy.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td style={{ ...tdRight, color: m.funding.amount_jpy >= 0 ? "#5dd58c" : "#ff8c8c" }}>
                    {m.funding.amount_jpy.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td style={{ ...tdRight, color: m.transfer.amount_jpy >= 0 ? "#5dd58c" : "#ff8c8c" }}>
                    {m.transfer.amount_jpy.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td style={{ ...tdRight, fontWeight: 600, color: m.total.amount_jpy >= 0 ? "#5dd58c" : "#ff8c8c" }}>
                    {m.total.amount_jpy.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td style={{ ...tdRight, color: m.missing > 0 ? "#f5d678" : "#888" }}>
                    {m.missing > 0 ? m.missing : "-"}
                  </td>
                </tr>
              ))}
              <tr style={{ ...trRow, fontWeight: 600 }}>
                <td style={td}>合計</td>
                <td style={{ ...tdRight, color: report.total.trade.amount_jpy >= 0 ? "#5dd58c" : "#ff8c8c" }}>
                  {report.total.trade.amount_jpy.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td style={{ ...tdRight, color: report.total.funding.amount_jpy >= 0 ? "#5dd58c" : "#ff8c8c" }}>
                  {report.total.funding.amount_jpy.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td style={{ ...tdRight, color: report.total.transfer.amount_jpy >= 0 ? "#5dd58c" : "#ff8c8c" }}>
                  {report.total.transfer.amount_jpy.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td style={{ ...tdRight, color: report.total.amount_jpy >= 0 ? "#5dd58c" : "#ff8c8c" }}>
                  {report.total.amount_jpy.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td style={tdRight}>
                  {report.total.missing > 0 ? report.total.missing : "-"}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <AccordionSection
        title="取引明細"
        countLabel={`${yearTrades.length} 件`}
      >
        {yearTrades.length === 0 ? (
          <p style={{ color: "#666" }}>この年度に取引はありません</p>
        ) : (
          <>
            <PaginationBar paging={tradePaging} />
            <table style={table}>
            <thead>
              <tr style={trHead}>
                <th style={th}>日付</th>
                <th style={th}>アカウント</th>
                <th style={th}>通貨</th>
                <th style={th}>方向</th>
                <th style={tdRightHead}>数量</th>
                <th style={tdRightHead}>価格</th>
                <th style={tdRightHead}>PnL (USD)</th>
                <th style={tdRightHead}>USD/JPY</th>
                <th style={tdRightHead}>PnL (JPY)</th>
              </tr>
            </thead>
            <tbody>
              {tradePaging.paged.map((t) => {
                const date = dateKeyJst(t.time);
                const fx = lookup(date);
                const jpy = fx ? t.closed_pnl * fx.rate : null;
                return (
                  <tr key={t.id} style={trRow}>
                    <td style={td}>{date}</td>
                    <td style={td}>{t.accountName}</td>
                    <td style={td}>{t.coin}</td>
                    <td
                      style={{
                        ...td,
                        color: t.dir.includes("Long") ? "#5dd58c" : "#ff8c8c",
                      }}
                    >
                      {t.dir}
                    </td>
                    <td style={tdRight}>
                      {t.sz.toLocaleString(undefined, {
                        maximumFractionDigits: 6,
                      })}
                    </td>
                    <td style={tdRight}>{t.px.toFixed(2)}</td>
                    <td
                      style={{
                        ...tdRight,
                        color: t.closed_pnl >= 0 ? "#5dd58c" : "#ff8c8c",
                      }}
                    >
                      {t.closed_pnl.toFixed(4)}
                    </td>
                    <FxCell
                      date={date}
                      fx={fx}
                      editing={editingDate === date}
                      editValue={editValue}
                      setEditValue={setEditValue}
                      onStart={() => startEdit(date, fx?.rate ?? null)}
                      onSave={saveEdit}
                      onCancel={cancelEdit}
                      saving={saving}
                    />
                    <JpyCell amount={jpy} />
                  </tr>
                );
              })}
            </tbody>
            </table>
          </>
        )}
      </AccordionSection>

      <AccordionSection
        title="ファンディング明細"
        countLabel={`${yearFundings.length} 件 — 全件が課税対象`}
      >
        {yearFundings.length === 0 ? (
          <p style={{ color: "#666" }}>この年度にファンディングはありません</p>
        ) : (
          <>
            <PaginationBar paging={fundingPaging} />
            <table style={table}>
            <thead>
              <tr style={trHead}>
                <th style={th}>日付</th>
                <th style={th}>アカウント</th>
                <th style={th}>通貨</th>
                <th style={th}>Side</th>
                <th style={tdRightHead}>金額 (USD)</th>
                <th style={tdRightHead}>USD/JPY</th>
                <th style={tdRightHead}>金額 (JPY)</th>
              </tr>
            </thead>
            <tbody>
              {fundingPaging.paged.map((f) => {
                const date = dateKeyJst(f.time);
                const fx = lookup(date);
                const jpy = fx ? f.payment * fx.rate : null;
                return (
                  <tr key={f.id} style={trRow}>
                    <td style={td}>{date}</td>
                    <td style={td}>{f.accountName}</td>
                    <td style={td}>{f.coin}</td>
                    <td style={td}>{f.side}</td>
                    <td
                      style={{
                        ...tdRight,
                        color: f.payment >= 0 ? "#5dd58c" : "#ff8c8c",
                      }}
                    >
                      {f.payment.toFixed(4)}
                    </td>
                    <FxCell
                      date={date}
                      fx={fx}
                      editing={editingDate === date}
                      editValue={editValue}
                      setEditValue={setEditValue}
                      onStart={() => startEdit(date, fx?.rate ?? null)}
                      onSave={saveEdit}
                      onCancel={cancelEdit}
                      saving={saving}
                    />
                    <JpyCell amount={jpy} />
                  </tr>
                );
              })}
            </tbody>
            </table>
          </>
        )}
      </AccordionSection>

      <AccordionSection
        title="入出金明細"
        countLabel={`${yearTransfers.length} 件 / 課税対象 ${yearTransfers.filter((t) => t.taxable).length} 件`}
      >
        <p
          style={{
            color: "#888",
            fontSize: "0.82rem",
            marginTop: 0,
            marginBottom: 8,
          }}
        >
          自己送金 (取引所間の振替) は課税対象外。サービス対価・贈与・
          売却代金など、実際の収入として受け取った USDC のみ
          「課税対象」にチェックを入れてください。出金行も列挙されますが
          通常はチェック不要です。
        </p>
        {yearTransfers.length === 0 ? (
          <p style={{ color: "#666" }}>この年度に入出金はありません</p>
        ) : (
          <>
            <PaginationBar paging={transferPaging} />
            <table style={table}>
            <thead>
              <tr style={trHead}>
                <th style={th}>日付</th>
                <th style={th}>アカウント</th>
                <th style={th}>Action</th>
                <th style={th}>From → To</th>
                <th style={tdRightHead}>金額</th>
                <th style={th}>通貨</th>
                <th style={{ ...th, textAlign: "center" }}>課税対象</th>
                <th style={tdRightHead}>USD/JPY</th>
                <th style={tdRightHead}>金額 (JPY)</th>
              </tr>
            </thead>
            <tbody>
              {transferPaging.paged.map((tr) => {
                const date = dateKeyJst(tr.time);
                const fx = lookup(date);
                const jpy =
                  tr.taxable && fx ? tr.account_value_change * fx.rate : null;
                return (
                  <tr key={tr.id} style={trRow}>
                    <td style={td}>{date}</td>
                    <td style={td}>{tr.accountName}</td>
                    <td style={td}>{tr.action}</td>
                    <td
                      style={{
                        ...td,
                        color: "#aab",
                        fontSize: "0.82rem",
                      }}
                    >
                      {tr.source} → {tr.destination}
                    </td>
                    <td
                      style={{
                        ...tdRight,
                        color:
                          tr.account_value_change >= 0 ? "#5dd58c" : "#ff8c8c",
                      }}
                    >
                      {tr.account_value_change.toFixed(4)}
                    </td>
                    <td style={td}>{tr.currency}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={tr.taxable}
                        onChange={(e) =>
                          onToggleTaxable(tr.id, e.target.checked)
                        }
                        title="確定申告で「その他収入」として計上する"
                      />
                    </td>
                    <FxCell
                      date={date}
                      fx={fx}
                      editing={editingDate === date}
                      editValue={editValue}
                      setEditValue={setEditValue}
                      onStart={() => startEdit(date, fx?.rate ?? null)}
                      onSave={saveEdit}
                      onCancel={cancelEdit}
                      saving={saving}
                    />
                    <JpyCell
                      amount={jpy}
                      placeholder={!tr.taxable ? "—" : "-"}
                    />
                  </tr>
                );
              })}
            </tbody>
            </table>
          </>
        )}
      </AccordionSection>

      <p style={{ color: "#888", fontSize: "0.8rem", marginTop: 12 }}>
        USD/JPY 列をクリックすると、その日のレートを直接登録できます
        (同じ日付のレコードすべてに自動反映)。* 印は直近過去レートを
        carry-forward 中の行。
      </p>
    </div>
  );
}

interface FxCellProps {
  date: string;
  fx: { rate: number; fxDate: string; carriedForward: boolean } | null;
  editing: boolean;
  editValue: string;
  setEditValue: (v: string) => void;
  onStart: () => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

function FxCell({
  date,
  fx,
  editing,
  editValue,
  setEditValue,
  onStart,
  onSave,
  onCancel,
  saving,
}: FxCellProps) {
  return (
    <td style={tdRight}>
      {editing ? (
        <span
          style={{
            display: "inline-flex",
            gap: 4,
            alignItems: "center",
          }}
        >
          <input
            autoFocus
            type="number"
            step="0.001"
            min="0.001"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave();
              if (e.key === "Escape") onCancel();
            }}
            style={inlineInput}
            disabled={saving}
          />
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            style={btnInlinePrimary}
            title="保存 (Enter)"
          >
            ✓
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={btnInlineGhost}
            title="キャンセル (Esc)"
          >
            ×
          </button>
        </span>
      ) : fx ? (
        <span
          onClick={onStart}
          title={
            fx.carriedForward
              ? `${fx.fxDate} のレートを carry-forward 中。クリックで ${date} のレートを直接登録`
              : "クリックして編集"
          }
          style={{
            color: fx.carriedForward ? "#f5d678" : "#aab",
            cursor: "pointer",
            borderBottom: "1px dotted #555",
          }}
        >
          {fx.rate.toFixed(3)}
          {fx.carriedForward && "*"}
        </span>
      ) : (
        <button
          type="button"
          onClick={onStart}
          style={btnInlineMissing}
          title="この日のレートを入力"
        >
          + 入力
        </button>
      )}
    </td>
  );
}

function JpyCell({
  amount,
  placeholder = "-",
}: {
  amount: number | null;
  placeholder?: string;
}) {
  return (
    <td
      style={{
        ...tdRight,
        color:
          amount == null
            ? "#666"
            : amount >= 0
              ? "#5dd58c"
              : "#ff8c8c",
      }}
    >
      {amount != null
        ? amount.toLocaleString(undefined, { maximumFractionDigits: 0 })
        : placeholder}
    </td>
  );
}

interface PagingState {
  page: number;
  totalPages: number;
  pageSize: number | "all";
  total: number;
  startIdx: number;
  endIdx: number;
  setPage: (p: number) => void;
  setPageSize: (s: number | "all") => void;
}

interface UsePaginationResult<T> extends PagingState {
  paged: T[];
}

/**
 * Slice an array into pages. `resetKey` resets the current page to 1 when its
 * identity changes (used to reset on year switch).
 */
function usePagination<T>(items: T[], resetKey: unknown): UsePaginationResult<T> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState<number | "all">(50);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const setPageSize = (size: number | "all") => {
    setPageSizeState(size);
    setPage(1);
  };

  const total = items.length;
  const isAll = pageSize === "all";
  const totalPages = isAll ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIdx = isAll || total === 0 ? 0 : (safePage - 1) * pageSize;
  const endIdx = isAll ? total : Math.min(startIdx + pageSize, total);
  const paged = isAll ? items : items.slice(startIdx, endIdx);

  return {
    paged,
    page: safePage,
    totalPages,
    pageSize,
    total,
    startIdx,
    endIdx,
    setPage,
    setPageSize,
  };
}

function PaginationBar({ paging }: { paging: PagingState }) {
  const {
    page,
    totalPages,
    pageSize,
    total,
    startIdx,
    endIdx,
    setPage,
    setPageSize,
  } = paging;
  if (total === 0) return null;
  const navBtn = (disabled: boolean): React.CSSProperties => ({
    background: "transparent",
    color: disabled ? "#555" : COLORS.muted,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    padding: "0.15rem 0.45rem",
    cursor: disabled ? "not-allowed" : "pointer",
    minWidth: 26,
    fontSize: "0.85rem",
  });
  const atFirst = page === 1;
  const atLast = page >= totalPages;
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        justifyContent: "flex-end",
        flexWrap: "wrap",
        marginBottom: 8,
        fontSize: "0.82rem",
        color: COLORS.muted,
      }}
    >
      <label>
        表示件数{" "}
        <select
          value={pageSize}
          onChange={(e) => {
            const v = e.target.value;
            setPageSize(v === "all" ? "all" : Number(v));
          }}
          style={{
            background: COLORS.inputBg,
            color: COLORS.text,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 4,
            padding: "0.15rem 0.3rem",
            marginLeft: 4,
          }}
        >
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="all">全件</option>
        </select>
      </label>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {(startIdx + 1).toLocaleString()} - {endIdx.toLocaleString()} /{" "}
        {total.toLocaleString()} 件
      </span>
      <button
        type="button"
        onClick={() => setPage(1)}
        disabled={atFirst}
        style={navBtn(atFirst)}
        title="先頭ページ"
      >
        «
      </button>
      <button
        type="button"
        onClick={() => setPage(page - 1)}
        disabled={atFirst}
        style={navBtn(atFirst)}
        title="前のページ"
      >
        ‹
      </button>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {page} / {totalPages}
      </span>
      <button
        type="button"
        onClick={() => setPage(page + 1)}
        disabled={atLast}
        style={navBtn(atLast)}
        title="次のページ"
      >
        ›
      </button>
      <button
        type="button"
        onClick={() => setPage(totalPages)}
        disabled={atLast}
        style={navBtn(atLast)}
        title="末尾ページ"
      >
        »
      </button>
    </div>
  );
}

function AccordionSection({
  title,
  countLabel,
  defaultOpen = true,
  children,
}: {
  title: string;
  countLabel: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section style={section}>
      <h2
        style={{
          ...h2,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          userSelect: "none",
          marginBottom: open ? "0.6rem" : 0,
        }}
        onClick={() => setOpen((o) => !o)}
        role="button"
        aria-expanded={open}
      >
        <span style={{ fontSize: "0.75em", color: COLORS.muted }}>
          {open ? "▼" : "▶"}
        </span>
        <span style={{ color: COLORS.text }}>{title}</span>
        <span
          style={{
            color: COLORS.subtle,
            fontWeight: 400,
            fontSize: "0.85em",
          }}
        >
          ({countLabel})
        </span>
      </h2>
      {open && children}
    </section>
  );
}

function Kpis({ report }: { report: TaxReport }) {
  const kpis = [
    {
      label: "取引 PnL (JPY)",
      value: report.total.trade.amount_jpy.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      }),
      color:
        report.total.trade.amount_jpy >= 0 ? "#5dd58c" : "#ff8c8c",
    },
    {
      label: "ファンディング (JPY)",
      value: report.total.funding.amount_jpy.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      }),
      color:
        report.total.funding.amount_jpy >= 0 ? "#5dd58c" : "#ff8c8c",
    },
    {
      label: "その他収入 (JPY)",
      value: report.total.transfer.amount_jpy.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      }),
      color:
        report.total.transfer.amount_jpy >= 0 ? "#5dd58c" : "#ff8c8c",
    },
    {
      label: "合計 (JPY)",
      value: report.total.amount_jpy.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      }),
      color: report.total.amount_jpy >= 0 ? "#5dd58c" : "#ff8c8c",
    },
    {
      label: "レート欠損",
      value: report.total.missing.toLocaleString(),
      color: report.total.missing > 0 ? "#f5d678" : "#aab",
    },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        gap: "0.8rem",
        marginTop: "1rem",
      }}
    >
      {kpis.map((k) => (
        <div
          key={k.label}
          style={{
            background: "#141823",
            border: "1px solid #2a3047",
            borderRadius: 8,
            padding: "0.8rem 1rem",
          }}
        >
          <div style={{ color: "#888", fontSize: "0.8rem" }}>{k.label}</div>
          <div
            style={{
              color: k.color,
              fontSize: "1.4rem",
              fontWeight: 600,
              marginTop: 4,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {k.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** TaxReport-local: plain top-margin spacer, *not* the shared panel `section`. */
const section: React.CSSProperties = { marginTop: "1.8rem" };
const selectStyle: React.CSSProperties = {
  background: "#0f1218",
  color: "#e6e6e6",
  border: "1px solid #2a3047",
  borderRadius: 6,
  padding: "0.35rem 0.5rem",
  marginLeft: 6,
};
const inlineInput: React.CSSProperties = {
  background: "#0f1218",
  color: "#e6e6e6",
  border: "1px solid #2a3047",
  borderRadius: 4,
  padding: "0.15rem 0.35rem",
  width: 80,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
const btnInlinePrimary: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  padding: "0.15rem 0.45rem",
  cursor: "pointer",
  fontSize: "0.85rem",
};
const btnInlineGhost: React.CSSProperties = {
  background: "transparent",
  color: "#aab",
  border: "1px solid #2a3047",
  borderRadius: 4,
  padding: "0.15rem 0.45rem",
  cursor: "pointer",
  fontSize: "0.85rem",
};
const btnInlineMissing: React.CSSProperties = {
  background: "transparent",
  color: "#f5d678",
  border: "1px dashed #6b522a",
  borderRadius: 4,
  padding: "0.15rem 0.5rem",
  cursor: "pointer",
  fontSize: "0.8rem",
};
