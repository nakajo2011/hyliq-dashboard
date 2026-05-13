import { useEffect, useRef, useState } from "react";
import { pb } from "../lib/pb";
import {
  fetchFrankfurterRange,
  parseBulkFxInput,
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

  // ── みずほ CSV 取り込み state ────────────────────────────────────
  const [mizuhoFile, setMizuhoFile] = useState<File | null>(null);
  const [mizuhoParsed, setMizuhoParsed] = useState<MizuhoParseResult | null>(
    null
  );
  const [mizuhoStatus, setMizuhoStatus] = useState<
    | { status: "idle" }
    | { status: "running" }
    | { status: "done"; saved: number; skipped: number }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [mizuhoDrag, setMizuhoDrag] = useState(false);
  const mizuhoInputRef = useRef<HTMLInputElement>(null);

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

  const handleMizuhoFile = async (file: File) => {
    setMizuhoFile(file);
    setMizuhoParsed(null);
    setMizuhoStatus({ status: "idle" });
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseMizuhoCsv(buf);
      setMizuhoParsed(parsed);
      if (parsed.rates.length === 0 && parsed.errors.length > 0) {
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
      await reload();
    } catch (e) {
      setMizuhoStatus({
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
          みずほ銀行が公開している{" "}
          <code>quote.csv</code>{" "}
          には 2002 年以降の日次 TTM (公示仲値) が 1 ファイルにまとまっています。
          国税庁が認める銀行公示レートで、確定申告で最も使われる標準値です。
          ブラウザでダウンロードしてから下にアップロードしてください
          (スクレイプは行いません)。
        </p>

        <ol style={{ paddingLeft: "1.2rem", margin: "0.8rem 0", lineHeight: 1.7 }}>
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
              <strong>{mizuhoParsed.rates.length} 件</strong> のレートを抽出
              {mizuhoParsed.range && (
                <>
                  {" "}
                  ({mizuhoParsed.range.start} 〜 {mizuhoParsed.range.end})
                </>
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
                <span style={{ marginLeft: 12, fontSize: "0.85rem", color: "#aab" }}>
                  「既存レートを上書きしない」設定が共通で適用されます
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

      <section style={section}>
        <h2 style={h2}>API から取得 (Frankfurter / ECB)</h2>
        <p style={{ color: "#888", fontSize: "0.85rem", marginTop: 0 }}>
          Frankfurter API (ECB が公開する日次レート、無料・API キー不要) から USD/JPY を一括取得します。
          週末・祝日は ECB が公開しないため欠落しますが、後段の carry-forward で吸収されます。
          確定申告では原則 銀行公示 TTM レートですが、ECB ベースは実務上の目安として広く使われています。
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
