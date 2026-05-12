import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { pb } from "../lib/pb";
import { buildFxLookup, upsertFxRate, type FxRate } from "../lib/fx";
import {
  buildTaxReport,
  listAvailableYears,
  toCsv,
  type TaxReport,
  type TaxTradeInput,
} from "../lib/tax";
import type { TradeLike } from "../lib/pnl";

type TradeRecord = TradeLike & { id: string; account: string };
type AccountRecord = { id: string; name: string };
type FxRecord = FxRate & { id: string };

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      trades: TaxTradeInput[];
      fxRates: FxRate[];
    };

export function TaxReport() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [accounts, trades, fxRows] = await Promise.all([
          pb.collection("accounts").getFullList<AccountRecord>(),
          pb.collection("trades").getFullList<TradeRecord>({ sort: "+time" }),
          pb.collection("fx_rates").getFullList<FxRecord>(),
        ]);
        if (cancelled) return;
        const accountById = new Map(accounts.map((a) => [a.id, a.name]));
        const enriched: TaxTradeInput[] = trades.map((t) => ({
          id: t.id,
          accountName: accountById.get(t.account) ?? "(unknown)",
          time: t.time,
          coin: t.coin,
          dir: t.dir,
          px: t.px,
          sz: t.sz,
          fee: t.fee,
          closed_pnl: t.closed_pnl,
        }));
        const fxRates: FxRate[] = fxRows.map((r) => ({
          date: r.date.slice(0, 10),
          usd_jpy: r.usd_jpy,
        }));
        setState({ status: "ready", trades: enriched, fxRates });
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
      const years = listAvailableYears(state.trades);
      if (years.length > 0) setYear(years[0]);
    }
  }, [state, year]);

  if (state.status === "loading") return <p>読み込み中...</p>;
  if (state.status === "error")
    return <p style={{ color: "#ff6b6b" }}>❌ {state.message}</p>;

  const availableYears = listAvailableYears(state.trades);
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

  return (
    <ReportView
      year={activeYear}
      availableYears={availableYears}
      onChangeYear={setYear}
      trades={state.trades}
      fxRates={state.fxRates}
      onFxChanged={reloadFxRates}
    />
  );
}

function ReportView({
  year,
  availableYears,
  onChangeYear,
  trades,
  fxRates,
  onFxChanged,
}: {
  year: number;
  availableYears: number[];
  onChangeYear: (y: number) => void;
  trades: TaxTradeInput[];
  fxRates: FxRate[];
  onFxChanged: () => Promise<void>;
}) {
  const lookup = useMemo(() => buildFxLookup(fxRates), [fxRates]);
  const report = useMemo(
    () => buildTaxReport(trades, lookup, year),
    [trades, lookup, year]
  );

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
        <h2 style={h2}>月別合計</h2>
        {report.monthlyTotals.length === 0 ? (
          <p style={{ color: "#666" }}>この年度に取引はありません</p>
        ) : (
          <table style={table}>
            <thead>
              <tr style={trHead}>
                <th style={th}>月</th>
                <th style={tdRightH}>件数</th>
                <th style={tdRightH}>PnL (USD)</th>
                <th style={tdRightH}>PnL (JPY)</th>
                <th style={tdRightH}>レート欠損</th>
              </tr>
            </thead>
            <tbody>
              {report.monthlyTotals.map((m) => (
                <tr key={m.month} style={trRow}>
                  <td style={td}>{m.month}</td>
                  <td style={tdRight}>{m.rows}</td>
                  <td
                    style={{
                      ...tdRight,
                      color: m.pnl_usd >= 0 ? "#5dd58c" : "#ff8c8c",
                    }}
                  >
                    {m.pnl_usd.toFixed(2)}
                  </td>
                  <td
                    style={{
                      ...tdRight,
                      color: m.pnl_jpy >= 0 ? "#5dd58c" : "#ff8c8c",
                    }}
                  >
                    {m.pnl_jpy.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </td>
                  <td
                    style={{
                      ...tdRight,
                      color: m.missing > 0 ? "#f5d678" : "#888",
                    }}
                  >
                    {m.missing > 0 ? m.missing : "-"}
                  </td>
                </tr>
              ))}
              <tr style={{ ...trRow, fontWeight: 600 }}>
                <td style={td}>合計</td>
                <td style={tdRight}>{report.total.rows}</td>
                <td
                  style={{
                    ...tdRight,
                    color: report.total.pnl_usd >= 0 ? "#5dd58c" : "#ff8c8c",
                  }}
                >
                  {report.total.pnl_usd.toFixed(2)}
                </td>
                <td
                  style={{
                    ...tdRight,
                    color: report.total.pnl_jpy >= 0 ? "#5dd58c" : "#ff8c8c",
                  }}
                >
                  {report.total.pnl_jpy.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </td>
                <td style={tdRight}>
                  {report.total.missing > 0 ? report.total.missing : "-"}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section style={section}>
        <h2 style={h2}>取引明細 ({report.rows.length} 件)</h2>
        {report.rows.length === 0 ? (
          <p style={{ color: "#666" }}>この年度に取引はありません</p>
        ) : (
          <table style={table}>
            <thead>
              <tr style={trHead}>
                <th style={th}>日付</th>
                <th style={th}>アカウント</th>
                <th style={th}>通貨</th>
                <th style={th}>方向</th>
                <th style={tdRightH}>数量</th>
                <th style={tdRightH}>価格</th>
                <th style={tdRightH}>PnL (USD)</th>
                <th style={tdRightH}>USD/JPY</th>
                <th style={tdRightH}>PnL (JPY)</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.tradeId} style={trRow}>
                  <td style={td}>{r.date}</td>
                  <td style={td}>{r.accountName}</td>
                  <td style={td}>{r.coin}</td>
                  <td
                    style={{
                      ...td,
                      color: r.dir.includes("Long") ? "#5dd58c" : "#ff8c8c",
                    }}
                  >
                    {r.dir}
                  </td>
                  <td style={tdRight}>
                    {r.sz.toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    })}
                  </td>
                  <td style={tdRight}>{r.px.toFixed(2)}</td>
                  <td
                    style={{
                      ...tdRight,
                      color: r.pnl_usd >= 0 ? "#5dd58c" : "#ff8c8c",
                    }}
                  >
                    {r.pnl_usd.toFixed(4)}
                  </td>
                  <td style={tdRight}>
                    {editingDate === r.date ? (
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
                            if (e.key === "Enter") saveEdit();
                            if (e.key === "Escape") cancelEdit();
                          }}
                          style={inlineInput}
                          disabled={saving}
                        />
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={saving}
                          style={btnInlinePrimary}
                          title="保存 (Enter)"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={saving}
                          style={btnInlineGhost}
                          title="キャンセル (Esc)"
                        >
                          ×
                        </button>
                      </span>
                    ) : r.fx_rate != null ? (
                      <span
                        onClick={() => startEdit(r.date, r.fx_rate)}
                        title={
                          r.fx_carried_forward
                            ? `${r.fx_date} のレートを carry-forward 中。クリックで ${r.date} のレートを直接登録`
                            : "クリックして編集"
                        }
                        style={{
                          color: r.fx_carried_forward ? "#f5d678" : "#aab",
                          cursor: "pointer",
                          borderBottom: "1px dotted #555",
                        }}
                      >
                        {r.fx_rate.toFixed(3)}
                        {r.fx_carried_forward && "*"}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(r.date, null)}
                        style={btnInlineMissing}
                        title="この日のレートを入力"
                      >
                        + 入力
                      </button>
                    )}
                  </td>
                  <td
                    style={{
                      ...tdRight,
                      color:
                        r.pnl_jpy == null
                          ? "#666"
                          : r.pnl_jpy >= 0
                            ? "#5dd58c"
                            : "#ff8c8c",
                    }}
                  >
                    {r.pnl_jpy != null
                      ? r.pnl_jpy.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ color: "#888", fontSize: "0.8rem", marginTop: 8 }}>
          USD/JPY 列をクリックすると、その日のレートを直接登録できます
          (同じ日付の取引すべてに自動反映されます)。* 印は当日のレート未登録のため直近過去のレートで換算した行。
        </p>
      </section>
    </div>
  );
}

function Kpis({ report }: { report: TaxReport }) {
  const kpis = [
    {
      label: "取引数",
      value: report.total.rows.toLocaleString(),
      color: "#aab",
    },
    {
      label: "PnL (USD)",
      value: report.total.pnl_usd.toLocaleString(undefined, {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }),
      color: report.total.pnl_usd >= 0 ? "#5dd58c" : "#ff8c8c",
    },
    {
      label: "PnL (JPY)",
      value: report.total.pnl_jpy.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      }),
      color: report.total.pnl_jpy >= 0 ? "#5dd58c" : "#ff8c8c",
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

const section: React.CSSProperties = {
  marginTop: "1.8rem",
};
const h2: React.CSSProperties = {
  marginBottom: "0.6rem",
  color: "#aab",
  fontSize: "1rem",
};
const selectStyle: React.CSSProperties = {
  background: "#0f1218",
  color: "#e6e6e6",
  border: "1px solid #2a3047",
  borderRadius: 6,
  padding: "0.35rem 0.5rem",
  marginLeft: 6,
};
const btnPrimary: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "0.45rem 1rem",
  cursor: "pointer",
};
const btnDisabled: React.CSSProperties = {
  ...btnPrimary,
  background: "#2a3047",
  color: "#666",
  cursor: "not-allowed",
};
const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.88rem",
};
const trHead: React.CSSProperties = {
  borderBottom: "1px solid #2a3047",
  color: "#aab",
};
const trRow: React.CSSProperties = { borderBottom: "1px solid #1a1f2c" };
const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.55rem 0.6rem",
  fontWeight: 500,
  fontSize: "0.78rem",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const tdRightH: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = {
  padding: "0.5rem 0.6rem",
  verticalAlign: "middle",
};
const tdRight: React.CSSProperties = {
  ...td,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
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
