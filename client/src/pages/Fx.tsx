import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { pb } from "../lib/pb";
import {
  fetchFrankfurterRange,
  parseMizuhoCsv,
  upsertFxRate,
  type MizuhoParseResult,
} from "../lib/fx";
import { dateKeyJst } from "../lib/pnl";

interface FxRow {
  id: string;
  date: string; // PocketBase date string (e.g. "2026-04-02 00:00:00.000Z")
  usd_jpy: number;
  source: string;
}

function dateOnly(s: string): string {
  return s.slice(0, 10);
}

export function Fx() {
  const [rows, setRows] = useState<FxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── 共通設定 ──────────────────────────────────────────────
  const [skipExisting, setSkipExisting] = useState(true);

  // ── みずほ CSV 取り込み state ────────────────────────────────
  const [mizuhoFile, setMizuhoFile] = useState<File | null>(null);
  const [mizuhoParsed, setMizuhoParsed] = useState<MizuhoParseResult | null>(
    null
  );
  /** Counts before / after the "trade-date filter" applied to a parsed file. */
  const [mizuhoFilter, setMizuhoFilter] = useState<{
    totalParsed: number;
    droppedBeforeTrades: number;
    earliestTradeDate: string | null;
  } | null>(null);
  const [mizuhoStatus, setMizuhoStatus] = useState<
    | { status: "idle" }
    | { status: "running" }
    | { status: "done"; saved: number; skipped: number }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [mizuhoDrag, setMizuhoDrag] = useState(false);
  const mizuhoInputRef = useRef<HTMLInputElement>(null);

  // ── Frankfurter (ECB) state ────────────────────────────────
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [apiStatus, setApiStatus] = useState<
    | { status: "idle" }
    | { status: "running" }
    | {
        status: "done";
        range: string;
        fetched: number;
        saved: number;
        skipped: number;
      }
    | { status: "error"; message: string }
  >({ status: "idle" });

  // ── 折れ線グラフ用フィルタ ─────────────────────────────────
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [deleting, setDeleting] = useState(false);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const filterParts: string[] = [];
      if (filterFrom) filterParts.push(`date >= "${filterFrom} 00:00:00.000Z"`);
      if (filterTo) {
        const d = new Date(filterTo + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + 1);
        const endExclusive = d.toISOString().slice(0, 10);
        filterParts.push(`date < "${endExclusive} 00:00:00.000Z"`);
      }
      const filter = filterParts.join(" && ");

      const list = await pb
        .collection("fx_rates")
        .getFullList<FxRow>({ sort: "+date", filter: filter || undefined });
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterFrom, filterTo]);

  // ── みずほ CSV ハンドラ ──────────────────────────────────
  const handleMizuhoFile = async (file: File) => {
    setMizuhoFile(file);
    setMizuhoParsed(null);
    setMizuhoFilter(null);
    setMizuhoStatus({ status: "idle" });
    try {
      // Look up the earliest trade date (JST) so we can skip pre-trade rates
      // and not bloat the DB with decades of unused history.
      let earliest: string | null = null;
      try {
        const first = await pb
          .collection("trades")
          .getList<{ time: string }>(1, 1, {
            sort: "+time",
            fields: "time",
          });
        if (first.items.length > 0) {
          earliest = dateKeyJst(first.items[0].time);
        }
      } catch {
        // ignore — if we can't look up trades, fall back to importing all
      }

      const buf = await file.arrayBuffer();
      const parsed = parseMizuhoCsv(buf);

      let rates = parsed.rates;
      let dropped = 0;
      if (earliest) {
        const before = rates.length;
        rates = rates.filter((r) => r.date >= earliest);
        dropped = before - rates.length;
      }

      setMizuhoParsed({
        rates,
        errors: parsed.errors,
        range:
          rates.length > 0
            ? { start: rates[0].date, end: rates[rates.length - 1].date }
            : undefined,
      });
      setMizuhoFilter({
        totalParsed: parsed.rates.length,
        droppedBeforeTrades: dropped,
        earliestTradeDate: earliest,
      });

      if (rates.length === 0 && parsed.errors.length > 0) {
        setMizuhoStatus({ status: "error", message: parsed.errors[0] });
      }
    } catch (e) {
      setMizuhoStatus({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleMizuhoSave = async () => {
    if (!mizuhoParsed || mizuhoParsed.rates.length === 0) return;
    setMizuhoStatus({ status: "running" });

    let existing = new Set<string>();
    if (skipExisting) {
      try {
        const list = await pb
          .collection("fx_rates")
          .getFullList<{ date: string }>({ fields: "date" });
        existing = new Set(list.map((r) => dateOnly(r.date)));
      } catch {
        // proceed without skip set
      }
    }

    let saved = 0;
    let skipped = 0;
    try {
      for (const r of mizuhoParsed.rates) {
        if (existing.has(r.date)) {
          skipped++;
        } else {
          await upsertFxRate(r.date, r.usd_jpy);
          saved++;
        }
      }
      setMizuhoStatus({ status: "done", saved, skipped });
      setMizuhoFile(null);
      setMizuhoParsed(null);
      setMizuhoFilter(null);
      await reload();
    } catch (e) {
      setMizuhoStatus({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  // ── Frankfurter ハンドラ ──────────────────────────────────
  const apiFetchAndStore = async (from: string, to: string) => {
    setApiStatus({ status: "running" });
    try {
      const result = await fetchFrankfurterRange(from, to);

      let existing = new Set<string>();
      if (skipExisting) {
        const list = await pb
          .collection("fx_rates")
          .getFullList<{ date: string }>({ fields: "date" });
        existing = new Set(list.map((r) => dateOnly(r.date)));
      }

      let saved = 0;
      let skipped = 0;
      for (const r of result.rates) {
        if (existing.has(r.date)) {
          skipped++;
        } else {
          await upsertFxRate(r.date, r.usd_jpy);
          saved++;
        }
      }

      setApiStatus({
        status: "done",
        range: `${result.startDate} 〜 ${result.endDate}`,
        fetched: result.rates.length,
        saved,
        skipped,
      });
      await reload();
    } catch (e) {
      setApiStatus({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleFetchTradeRange = async () => {
    try {
      const trades = await pb
        .collection("trades")
        .getFullList<{ time: string }>({ fields: "time", sort: "+time" });
      if (trades.length === 0) {
        alert("取引データがありません。Upload からインポートしてください。");
        return;
      }
      const earliest = dateKeyJst(trades[0].time);
      const latest = dateKeyJst(trades[trades.length - 1].time);
      await apiFetchAndStore(earliest, latest);
    } catch (e) {
      setApiStatus({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleFetchManualRange = async () => {
    if (!rangeFrom || !rangeTo) {
      alert("期間を指定してください");
      return;
    }
    await apiFetchAndStore(rangeFrom, rangeTo);
  };

  // ── 全削除 ─────────────────────────────────────────────
  const handleDeleteAll = async () => {
    if (deleting) return;
    // First confirmation
    const list = await pb
      .collection("fx_rates")
      .getFullList<{ id: string }>({ fields: "id" });
    const count = list.length;
    if (count === 0) {
      alert("削除するレートがありません");
      return;
    }
    if (
      !window.confirm(
        `本当に全 ${count.toLocaleString()} 件の FX レートを削除しますか？\n` +
          "元に戻せません (確定申告レポートが全件「未登録」になります)。"
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      // 20 並列ずつ削除 (5,500 件で約 30 秒)
      const CHUNK = 20;
      for (let i = 0; i < list.length; i += CHUNK) {
        const chunk = list.slice(i, i + CHUNK);
        await Promise.all(
          chunk.map((r) => pb.collection("fx_rates").delete(r.id))
        );
      }
      await reload();
    } catch (e) {
      alert(
        "削除中にエラーが発生しました: " +
          (e instanceof Error ? e.message : String(e))
      );
    } finally {
      setDeleting(false);
    }
  };

  // ── 折れ線グラフ用データ ─────────────────────────────────
  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        date: dateOnly(r.date),
        usd_jpy: r.usd_jpy,
      })),
    [rows]
  );

  const stats = useMemo(() => {
    if (rows.length === 0) return null;
    const values = rows.map((r) => r.usd_jpy);
    return {
      count: rows.length,
      min: Math.min(...values),
      max: Math.max(...values),
      first: rows[0],
      last: rows[rows.length - 1],
    };
  }, [rows]);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>FX レート (USD/JPY)</h1>
      <p style={{ color: "#888" }}>
        確定申告レポートの JPY 換算に使う為替レートを登録します。
        該当日が無い場合は直近過去のレートが自動的に使われます (carry-forward)。
      </p>

      {/* 共通設定 (各取り込みに共通で効く) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: "1rem",
          padding: "0.7rem 1rem",
          background: "#1c2030",
          border: "1px solid #2a3047",
          borderRadius: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            color: "#888",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          共通設定
        </span>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: "0.9rem",
          }}
        >
          <input
            type="checkbox"
            checked={skipExisting}
            onChange={(e) => setSkipExisting(e.target.checked)}
          />
          既存レートを上書きしない
        </label>
        <span style={{ fontSize: "0.8rem", color: "#666" }}>
          (みずほ / Frankfurter 両方の取り込みに適用)
        </span>
      </div>

      {/* みずほ CSV 取り込み (推奨) */}
      <section
        style={{
          ...section,
          border: "1px solid #2d5a3d",
          background: "#15281c",
        }}
      >
        <h2 style={h2}>
          みずほ CSV から TTM を取り込む{" "}
          <span style={{ color: "#5dd58c", fontSize: "0.8rem" }}>
            (確定申告で推奨)
          </span>
        </h2>
        <p style={{ color: "#aab", fontSize: "0.85rem", marginTop: 0 }}>
          みずほ銀行が公開している <code>quote.csv</code> には 2002 年以降の
          日次 TTM (公示仲値) が 1 ファイルにまとまっています。国税庁が認める
          銀行公示レートで、確定申告で最も使われる標準値です。
          ブラウザでダウンロードしてから下にアップロードしてください
          (スクレイプは行いません)。
        </p>

        <ol
          style={{ paddingLeft: "1.2rem", margin: "0.8rem 0", lineHeight: 1.7 }}
        >
          <li>
            <a
              href="https://www.mizuhobank.co.jp/market/quote.csv"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                marginTop: 4,
                background: "#2563eb",
                color: "#fff",
                padding: "0.4rem 0.9rem",
                borderRadius: 6,
                textDecoration: "none",
                fontSize: "0.9rem",
              }}
            >
              📥 quote.csv をダウンロード (新タブ)
            </a>{" "}
            <span style={{ color: "#888", fontSize: "0.8rem" }}>
              約 1.1MB、Shift_JIS、全期間 (2002〜現在)
            </span>
          </li>
          <li>
            ダウンロードしたファイルを下の枠にドラッグ&ドロップ、
            またはクリックして選択:
            <div
              onDragEnter={(ev) => {
                ev.preventDefault();
                setMizuhoDrag(true);
              }}
              onDragOver={(ev) => {
                ev.preventDefault();
                setMizuhoDrag(true);
              }}
              onDragLeave={() => setMizuhoDrag(false)}
              onDrop={(ev) => {
                ev.preventDefault();
                setMizuhoDrag(false);
                const file = ev.dataTransfer.files[0];
                if (file) handleMizuhoFile(file);
              }}
              onClick={() => mizuhoInputRef.current?.click()}
              style={{
                marginTop: 8,
                border: `2px dashed ${mizuhoDrag ? "#6cf" : "#3a5a4d"}`,
                background: mizuhoDrag ? "#1a2030" : "#0f1a14",
                borderRadius: 8,
                padding: "1.2rem",
                textAlign: "center",
                cursor: "pointer",
              }}
            >
              <input
                ref={mizuhoInputRef}
                type="file"
                accept=".csv"
                style={{ display: "none" }}
                onChange={(ev) => {
                  const file = ev.target.files?.[0];
                  if (file) handleMizuhoFile(file);
                  ev.target.value = "";
                }}
              />
              {mizuhoFile ? (
                <div>
                  <strong>{mizuhoFile.name}</strong>{" "}
                  <span style={{ color: "#888" }}>
                    ({(mizuhoFile.size / 1024).toFixed(0)} KB)
                  </span>
                </div>
              ) : (
                <span style={{ color: "#aab" }}>
                  ここに quote.csv をドロップ
                </span>
              )}
            </div>
          </li>
          {mizuhoParsed && mizuhoParsed.rates.length > 0 && (
            <li>
              <strong>{mizuhoParsed.rates.length.toLocaleString()} 件</strong>{" "}
              のレートを保存対象に抽出
              {mizuhoParsed.range && (
                <>
                  {" "}
                  ({mizuhoParsed.range.start} 〜 {mizuhoParsed.range.end})
                </>
              )}
              {mizuhoFilter &&
                mizuhoFilter.droppedBeforeTrades > 0 &&
                mizuhoFilter.earliestTradeDate && (
                  <div
                    style={{
                      fontSize: "0.82rem",
                      color: "#aab",
                      marginTop: 2,
                    }}
                  >
                    元データ {mizuhoFilter.totalParsed.toLocaleString()} 件 →
                    取引最古日 ({mizuhoFilter.earliestTradeDate}) 以降のみ採用、
                    {mizuhoFilter.droppedBeforeTrades.toLocaleString()} 件を
                    除外してストレージを節約
                  </div>
                )}
              {mizuhoFilter && !mizuhoFilter.earliestTradeDate && (
                <div
                  style={{
                    fontSize: "0.82rem",
                    color: "#f5d678",
                    marginTop: 2,
                  }}
                >
                  ⚠ 取引データがまだ無いため全期間をインポートします。
                  Upload 後に再取り込みすると不要分が除外されます。
                </div>
              )}
              {mizuhoParsed.errors.length > 0 && (
                <span style={{ color: "#f5d678", marginLeft: 6 }}>
                  (警告 {mizuhoParsed.errors.length} 件)
                </span>
              )}
              <div style={{ marginTop: 6 }}>
                <button
                  type="button"
                  onClick={handleMizuhoSave}
                  disabled={mizuhoStatus.status === "running"}
                  style={
                    mizuhoStatus.status === "running" ? btnDisabled : btnPrimary
                  }
                >
                  {mizuhoStatus.status === "running" ? "保存中..." : "保存"}
                </button>
                <span
                  style={{
                    marginLeft: 12,
                    fontSize: "0.85rem",
                    color: "#aab",
                  }}
                >
                  ↑ ページ上部の「共通設定」が適用されます
                </span>
              </div>
            </li>
          )}
        </ol>

        {mizuhoStatus.status === "done" && (
          <p style={{ color: "#5dd58c", marginTop: 8, fontSize: "0.9rem" }}>
            ✅ 新規 {mizuhoStatus.saved} 件、スキップ {mizuhoStatus.skipped} 件
          </p>
        )}
        {mizuhoStatus.status === "error" && (
          <p style={{ color: "#ff6b6b", marginTop: 8, fontSize: "0.9rem" }}>
            ❌ {mizuhoStatus.message}
          </p>
        )}
      </section>

      {/* Frankfurter (ECB) */}
      <section style={section}>
        <h2 style={h2}>API から取得 (Frankfurter / ECB)</h2>
        <p style={{ color: "#888", fontSize: "0.85rem", marginTop: 0 }}>
          Frankfurter API (ECB の日次レート、無料・API キー不要) から
          USD/JPY を一括取得します。週末・祝日は欠落しますが、
          carry-forward で吸収されます。MUFG TTM とは数値が微妙に異なる
          (通常 0.1〜0.5 円差) ため、確定申告本番には みずほ CSV を推奨します。
        </p>

        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: "0.8rem",
          }}
        >
          <button
            type="button"
            onClick={handleFetchTradeRange}
            disabled={apiStatus.status === "running"}
            style={apiStatus.status === "running" ? btnDisabled : btnPrimary}
          >
            {apiStatus.status === "running" ? "取得中..." : "取引日の全範囲を取得"}
          </button>
          <span style={{ color: "#666", fontSize: "0.85rem" }}>
            ← 取引データの最古日〜最新日まで一括取得
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <div>
            <label style={lbl}>From</label>
            <input
              type="date"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
              style={input}
            />
          </div>
          <div>
            <label style={lbl}>To</label>
            <input
              type="date"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
              style={input}
            />
          </div>
          <button
            type="button"
            onClick={handleFetchManualRange}
            disabled={
              apiStatus.status === "running" || !rangeFrom || !rangeTo
            }
            style={
              apiStatus.status === "running" || !rangeFrom || !rangeTo
                ? btnDisabled
                : btnPrimary
            }
          >
            期間を取得
          </button>
        </div>

        {apiStatus.status === "done" && (
          <p style={{ color: "#5dd58c", marginTop: "0.8rem", fontSize: "0.9rem" }}>
            ✅ {apiStatus.range}: API から {apiStatus.fetched} 件取得 → 新規{" "}
            {apiStatus.saved} 件、スキップ {apiStatus.skipped} 件
          </p>
        )}
        {apiStatus.status === "error" && (
          <p style={{ color: "#ff6b6b", marginTop: "0.8rem", fontSize: "0.9rem" }}>
            ❌ {apiStatus.message}
          </p>
        )}
      </section>

      {/* 登録済みレートの折れ線グラフ */}
      <section style={section}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h2 style={{ ...h2, marginBottom: 0 }}>
            登録済みレートの推移{" "}
            {stats && (
              <span
                style={{ color: "#666", fontWeight: 400, fontSize: "0.85rem" }}
              >
                ({stats.count.toLocaleString()} 件、
                {dateOnly(stats.first.date)} 〜 {dateOnly(stats.last.date)})
              </span>
            )}
          </h2>
          {stats && stats.count > 0 && (
            <button
              type="button"
              onClick={handleDeleteAll}
              disabled={deleting}
              style={deleting ? btnDangerDisabled : btnDanger}
              title="登録されている FX レートをすべて削除"
            >
              {deleting ? "削除中..." : "🗑 全削除"}
            </button>
          )}
        </div>

        {/* 期間フィルタ */}
        <div
          style={{
            display: "flex",
            gap: "0.6rem",
            alignItems: "flex-end",
            flexWrap: "wrap",
            marginBottom: "0.8rem",
          }}
        >
          <div>
            <label style={lbl}>From</label>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              style={input}
            />
          </div>
          <div>
            <label style={lbl}>To</label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              style={input}
            />
          </div>
          {(filterFrom || filterTo) && (
            <button
              type="button"
              onClick={() => {
                setFilterFrom("");
                setFilterTo("");
              }}
              style={btnGhost}
            >
              フィルタクリア
            </button>
          )}
        </div>

        {loading && <p>読み込み中...</p>}
        {error && <p style={{ color: "#ff6b6b" }}>❌ {error}</p>}

        {!loading && !error && rows.length === 0 && (
          <p style={{ color: "#888" }}>
            {filterFrom || filterTo
              ? "この期間にレートはありません"
              : "まだレートがありません。上のセクションから取り込んでください。"}
          </p>
        )}

        {!loading && rows.length > 0 && stats && (
          <>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData}>
                <CartesianGrid stroke="#222838" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  stroke="#888"
                  fontSize={12}
                  minTickGap={40}
                />
                <YAxis
                  stroke="#888"
                  fontSize={12}
                  domain={["auto", "auto"]}
                  tickFormatter={(v) =>
                    typeof v === "number" ? v.toFixed(1) : String(v)
                  }
                />
                <Tooltip
                  contentStyle={{
                    background: "#141823",
                    border: "1px solid #2a3047",
                  }}
                  labelStyle={{ color: "#aab" }}
                  formatter={(v) =>
                    typeof v === "number" ? v.toFixed(3) : String(v)
                  }
                />
                <Line
                  type="monotone"
                  dataKey="usd_jpy"
                  stroke="#6cf"
                  dot={false}
                  strokeWidth={1.5}
                />
              </LineChart>
            </ResponsiveContainer>

            <div
              style={{
                display: "flex",
                gap: "1.5rem",
                marginTop: "0.6rem",
                fontSize: "0.85rem",
                color: "#aab",
                flexWrap: "wrap",
              }}
            >
              <span>
                最新: <strong style={{ color: "#e6e6e6" }}>
                  {dateOnly(stats.last.date)} = {stats.last.usd_jpy.toFixed(3)}
                </strong>
              </span>
              <span>
                Min: <strong style={{ color: "#aab" }}>{stats.min.toFixed(3)}</strong>
              </span>
              <span>
                Max: <strong style={{ color: "#aab" }}>{stats.max.toFixed(3)}</strong>
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const section: React.CSSProperties = {
  marginTop: "1.5rem",
  padding: "1rem",
  background: "#141823",
  border: "1px solid #2a3047",
  borderRadius: 8,
};
const h2: React.CSSProperties = {
  marginTop: 0,
  marginBottom: "0.6rem",
  fontSize: "1rem",
  color: "#aab",
};
const lbl: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  color: "#aab",
  marginBottom: 4,
};
const input: React.CSSProperties = {
  background: "#0f1218",
  color: "#e6e6e6",
  border: "1px solid #2a3047",
  borderRadius: 6,
  padding: "0.4rem 0.6rem",
};
const btnPrimary: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "0.45rem 0.9rem",
  cursor: "pointer",
};
const btnDisabled: React.CSSProperties = {
  ...btnPrimary,
  background: "#2a3047",
  color: "#666",
  cursor: "not-allowed",
};
const btnGhost: React.CSSProperties = {
  background: "transparent",
  color: "#aab",
  border: "1px solid #2a3047",
  borderRadius: 6,
  padding: "0.3rem 0.7rem",
  cursor: "pointer",
};
const btnDanger: React.CSSProperties = {
  background: "transparent",
  color: "#ff8c8c",
  border: "1px solid #6b2a2a",
  borderRadius: 6,
  padding: "0.4rem 0.8rem",
  cursor: "pointer",
  fontSize: "0.9rem",
};
const btnDangerDisabled: React.CSSProperties = {
  ...btnDanger,
  color: "#555",
  cursor: "not-allowed",
};
