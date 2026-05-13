import { useEffect, useState } from "react";
import { pb, PB_URL } from "../lib/pb";
import {
  fetchFrankfurterRange,
  parseBulkFxInput,
  upsertFxRate,
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

  const [singleDate, setSingleDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [singleValue, setSingleValue] = useState("");

  const [bulkText, setBulkText] = useState("");
  const [bulkStatus, setBulkStatus] = useState<
    | { status: "idle" }
    | { status: "running" }
    | {
        status: "done";
        added: number;
        errors: { line: number; raw: string; message: string }[];
      }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const [skipExisting, setSkipExisting] = useState(true);
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

  const [mufgStatus, setMufgStatus] = useState<
    | { status: "idle" }
    | { status: "running"; total: number }
    | {
        status: "done";
        requestedDates: number;
        fetched: number;
        saved: number;
        skipped: number;
        nonBusiness: number;
        failed: number;
      }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await pb
        .collection("fx_rates")
        .getFullList<FxRow>({ sort: "-date" });
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const handleAddSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(singleValue);
    if (!isFinite(value) || value <= 0) {
      alert("レートが不正です");
      return;
    }
    try {
      await upsertFxRate(singleDate, value);
      setSingleValue("");
      await reload();
    } catch (e) {
      alert(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleBulk = async () => {
    const { rates, errors } = parseBulkFxInput(bulkText);
    if (rates.length === 0 && errors.length === 0) {
      alert("ペースト内容が空です");
      return;
    }
    setBulkStatus({ status: "running" });
    let added = 0;
    try {
      for (const r of rates) {
        await upsertFxRate(r.date, r.usd_jpy);
        added++;
      }
      setBulkText("");
      setBulkStatus({ status: "done", added, errors });
      await reload();
    } catch (e) {
      setBulkStatus({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

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

  const handleFetchMufg = async () => {
    // Count distinct trade dates first so we can show progress estimate.
    let totalDates = 0;
    try {
      const trades = await pb
        .collection("trades")
        .getFullList<{ time: string }>({ fields: "time" });
      const dateSet = new Set<string>();
      for (const t of trades) dateSet.add(dateKeyJst(t.time));
      totalDates = dateSet.size;
    } catch {
      // estimate unknown
    }
    if (totalDates === 0) {
      alert("取引データがありません。Upload からインポートしてください。");
      return;
    }

    setMufgStatus({ status: "running", total: totalDates });
    try {
      const url = `${PB_URL}/api/sync-fx-mufg?skipExisting=${skipExisting}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setMufgStatus({
        status: "done",
        requestedDates: data.requestedDates ?? 0,
        fetched: data.fetched ?? 0,
        saved: data.saved ?? 0,
        skipped: data.skipped ?? 0,
        nonBusiness: data.nonBusiness ?? 0,
        failed: data.failed ?? 0,
      });
      await reload();
    } catch (e) {
      setMufgStatus({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("このレートを削除しますか？")) return;
    try {
      await pb.collection("fx_rates").delete(id);
      await reload();
    } catch (e) {
      alert(`削除失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>FX レート (USD/JPY)</h1>
      <p style={{ color: "#888" }}>
        確定申告レポートの JPY 換算に使う為替レートを日付別に登録します。
        該当日が無い場合は直近過去のレートが自動的に使われます (carry-forward)。
      </p>

      <section style={{ ...section, borderColor: "#2d5a3d", background: "#15281c" }}>
        <h2 style={h2}>
          MUFG TTM を取得 <span style={{ color: "#5dd58c", fontSize: "0.8rem" }}>(確定申告で推奨)</span>
        </h2>
        <p style={{ color: "#aab", fontSize: "0.85rem", marginTop: 0 }}>
          三菱UFJ銀行 公示仲値 (TTM) を MURC (三菱UFJリサーチ&コンサルティング) サイトから一括取得します。
          国税庁が認める銀行公示レートで、日本の確定申告で最も使われる標準です。
          取引日 1 件あたり 1 リクエストかかるので、初回は数分かかります (週末・祝日は自動でスキップ)。
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={handleFetchMufg}
            disabled={mufgStatus.status === "running"}
            style={
              mufgStatus.status === "running" ? btnDisabled : btnPrimary
            }
          >
            {mufgStatus.status === "running"
              ? `取得中... (約 ${mufgStatus.total} 件処理)`
              : "取引日の全範囲を MUFG TTM で取得"}
          </button>
          <span style={{ color: "#666", fontSize: "0.85rem" }}>
            「既存レートを上書きしない」設定が共通で適用されます
          </span>
        </div>
        {mufgStatus.status === "done" && (
          <p style={{ color: "#5dd58c", marginTop: "0.8rem", fontSize: "0.9rem" }}>
            ✅ 要求 {mufgStatus.requestedDates} 件 → 新規 {mufgStatus.saved} 件、
            スキップ {mufgStatus.skipped} 件、休日 {mufgStatus.nonBusiness} 件
            {mufgStatus.failed > 0 && (
              <span style={{ color: "#ff8c8c" }}>、失敗 {mufgStatus.failed} 件</span>
            )}
          </p>
        )}
        {mufgStatus.status === "error" && (
          <p style={{ color: "#ff6b6b", marginTop: "0.8rem", fontSize: "0.9rem" }}>
            ❌ {mufgStatus.message}
          </p>
        )}
      </section>

      <section style={section}>
        <h2 style={h2}>API から取得 (Frankfurter / ECB)</h2>
        <p style={{ color: "#888", fontSize: "0.85rem", marginTop: 0 }}>
          Frankfurter API (ECB が公開する日次レート、無料・API キー不要) から USD/JPY を一括取得します。
          MUFG TTM とは数値が微妙に異なる (通常 0.1〜0.5 円差) ので、確定申告の本番には MUFG TTM 推奨。速報/参考用途向けです。
        </p>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 12,
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
            ← 取引データの最古日〜最新日まで一括取得 (推奨)
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
          <p
            style={{
              color: "#5dd58c",
              marginTop: "0.8rem",
              fontSize: "0.9rem",
            }}
          >
            ✅ {apiStatus.range}: API から {apiStatus.fetched} 件取得 → 新規{" "}
            {apiStatus.saved} 件、スキップ {apiStatus.skipped} 件
          </p>
        )}
        {apiStatus.status === "error" && (
          <p
            style={{
              color: "#ff6b6b",
              marginTop: "0.8rem",
              fontSize: "0.9rem",
            }}
          >
            ❌ {apiStatus.message}
          </p>
        )}
      </section>

      <section style={section}>
        <h2 style={h2}>レートを 1 件追加</h2>
        <form
          onSubmit={handleAddSingle}
          style={{
            display: "flex",
            gap: "0.6rem",
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <div>
            <label style={lbl}>日付</label>
            <input
              type="date"
              value={singleDate}
              onChange={(e) => setSingleDate(e.target.value)}
              required
              style={input}
            />
          </div>
          <div>
            <label style={lbl}>USD/JPY</label>
            <input
              type="number"
              step="0.001"
              min="0.001"
              value={singleValue}
              onChange={(e) => setSingleValue(e.target.value)}
              placeholder="150.500"
              required
              style={{ ...input, width: 140 }}
            />
          </div>
          <button type="submit" style={btnPrimary}>
            追加 / 上書き
          </button>
        </form>
      </section>

      <section style={section}>
        <h2 style={h2}>複数行ペースト</h2>
        <p style={{ color: "#888", fontSize: "0.85rem", marginTop: 0 }}>
          1 行 1 レート。"YYYY-MM-DD 150.50" のように、スペース / タブ /
          カンマ区切り、"/" / "-" どちらの日付形式でも OK。同じ日付があれば上書き。
        </p>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={6}
          placeholder={"2026-04-02 150.50\n2026-04-03 150.30\n2026-04-04,150.10"}
          style={{ ...input, width: "100%", fontFamily: "monospace" }}
        />
        <div style={{ marginTop: "0.6rem" }}>
          <button
            type="button"
            onClick={handleBulk}
            disabled={bulkStatus.status === "running" || !bulkText.trim()}
            style={
              bulkStatus.status === "running" || !bulkText.trim()
                ? btnDisabled
                : btnPrimary
            }
          >
            {bulkStatus.status === "running" ? "登録中..." : "一括登録"}
          </button>
        </div>
        {bulkStatus.status === "done" && (
          <div style={{ marginTop: "0.6rem", fontSize: "0.9rem" }}>
            <span style={{ color: "#5dd58c" }}>
              ✅ {bulkStatus.added} 件を保存
            </span>
            {bulkStatus.errors.length > 0 && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ color: "#ff8c8c", cursor: "pointer" }}>
                  パースできなかった行 ({bulkStatus.errors.length} 件)
                </summary>
                <ul
                  style={{
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                    color: "#ffb3b3",
                  }}
                >
                  {bulkStatus.errors.map((er) => (
                    <li key={er.line}>
                      L{er.line}: {er.raw} — {er.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {bulkStatus.status === "error" && (
          <p style={{ color: "#ff6b6b" }}>❌ {bulkStatus.message}</p>
        )}
      </section>

      <section style={section}>
        <h2 style={h2}>登録済みレート ({rows.length} 件)</h2>
        {loading && <p>読み込み中...</p>}
        {error && <p style={{ color: "#ff6b6b" }}>❌ {error}</p>}
        {!loading && !error && rows.length === 0 && (
          <p style={{ color: "#888" }}>まだレートがありません</p>
        )}
        {!loading && rows.length > 0 && (
          <table style={table}>
            <thead>
              <tr style={trHead}>
                <th style={th}>日付</th>
                <th style={{ ...th, textAlign: "right" }}>USD/JPY</th>
                <th style={th}>登録元</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={trRow}>
                  <td style={td}>{dateOnly(r.date)}</td>
                  <td style={tdRight}>{r.usd_jpy.toFixed(3)}</td>
                  <td style={{ ...td, color: "#888" }}>{r.source || "-"}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      style={btnDanger}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
const btnDanger: React.CSSProperties = {
  background: "transparent",
  color: "#ff8c8c",
  border: "1px solid #6b2a2a",
  borderRadius: 6,
  padding: "0.3rem 0.7rem",
  cursor: "pointer",
};
const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.9rem",
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
const td: React.CSSProperties = {
  padding: "0.5rem 0.6rem",
  verticalAlign: "middle",
};
const tdRight: React.CSSProperties = {
  ...td,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
