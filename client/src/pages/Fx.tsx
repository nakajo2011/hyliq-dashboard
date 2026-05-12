import { useEffect, useState } from "react";
import { pb } from "../lib/pb";
import { parseBulkFxInput, upsertFxRate } from "../lib/fx";

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
