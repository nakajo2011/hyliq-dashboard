import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { pb } from "../lib/pb";

interface AccountRow {
  id: string;
  address: string;
  label: string;
  note: string;
  trades: number;
  fundings: number;
  transfers: number;
}

interface RawAccount {
  id: string;
  address: string;
  label?: string;
  note?: string;
}

async function fetchAccountsWithCounts(): Promise<AccountRow[]> {
  const accounts = await pb
    .collection("accounts")
    .getFullList<RawAccount>({ sort: "address" });

  const rows = await Promise.all(
    accounts.map(async (a) => {
      const [trades, fundings, transfers] = await Promise.all([
        pb
          .collection("trades")
          .getList(1, 1, { filter: `account = "${a.id}"` })
          .then((r) => r.totalItems)
          .catch(() => 0),
        pb
          .collection("fundings")
          .getList(1, 1, { filter: `account = "${a.id}"` })
          .then((r) => r.totalItems)
          .catch(() => 0),
        pb
          .collection("transfers")
          .getList(1, 1, { filter: `account = "${a.id}"` })
          .then((r) => r.totalItems)
          .catch(() => 0),
      ]);
      return {
        id: a.id,
        address: a.address,
        label: a.label ?? "",
        note: a.note ?? "",
        trades,
        fundings,
        transfers,
      };
    })
  );
  return rows;
}

export function Accounts() {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; rows: AccountRow[] }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async () => {
    setState({ status: "loading" });
    try {
      const rows = await fetchAccountsWithCounts();
      setState({ status: "ready", rows });
    } catch (e) {
      setState({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const saveLabel = async (id: string) => {
    const newLabel = editing[id] ?? "";
    setBusy(id);
    try {
      await pb.collection("accounts").update(id, { label: newLabel });
      setEditing((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await reload();
    } catch (e) {
      alert(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const removeAccount = async (row: AccountRow) => {
    const total = row.trades + row.fundings + row.transfers;
    const msg =
      total > 0
        ? `${row.address}\n\n関連データ ${total} 件も全て削除されます。本当に削除しますか？`
        : `${row.address}\n\nこのアカウントを削除しますか？`;
    if (!window.confirm(msg)) return;

    setBusy(row.id);
    try {
      await pb.collection("accounts").delete(row.id);
      await reload();
    } catch (e) {
      alert(`削除失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Accounts</h1>
      <p style={{ color: "#888" }}>
        登録済みアカウント一覧。ラベルを付けて識別しやすくできます。削除時は関連データ
        (trades / fundings / transfers) も cascade で削除されます。
      </p>

      {state.status === "loading" && <p>読み込み中...</p>}
      {state.status === "error" && (
        <p style={{ color: "#ff6b6b" }}>❌ {state.message}</p>
      )}

      {state.status === "ready" && state.rows.length === 0 && (
        <p style={{ color: "#888" }}>
          まだアカウントがありません。<Link to="/upload">Upload</Link> から CSV を取り込むと自動で登録されます。
        </p>
      )}

      {state.status === "ready" && state.rows.length > 0 && (
        <table
          style={{
            width: "100%",
            marginTop: "1rem",
            borderCollapse: "collapse",
            fontSize: "0.9rem",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid #2a3047", color: "#aab" }}>
              <th style={th}>アドレス</th>
              <th style={th}>ラベル</th>
              <th style={{ ...th, textAlign: "right" }}>Trades</th>
              <th style={{ ...th, textAlign: "right" }}>Fundings</th>
              <th style={{ ...th, textAlign: "right" }}>Transfers</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row) => {
              const isEditing = editing[row.id] !== undefined;
              return (
                <tr
                  key={row.id}
                  style={{ borderBottom: "1px solid #1a1f2c" }}
                >
                  <td style={{ ...td, fontFamily: "monospace" }}>
                    {row.address}
                  </td>
                  <td style={td}>
                    {isEditing ? (
                      <input
                        autoFocus
                        type="text"
                        value={editing[row.id]}
                        onChange={(e) =>
                          setEditing((prev) => ({
                            ...prev,
                            [row.id]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveLabel(row.id);
                          if (e.key === "Escape")
                            setEditing((prev) => {
                              const n = { ...prev };
                              delete n[row.id];
                              return n;
                            });
                        }}
                        style={inputStyle}
                      />
                    ) : (
                      <span
                        onClick={() =>
                          setEditing((prev) => ({
                            ...prev,
                            [row.id]: row.label,
                          }))
                        }
                        style={{
                          cursor: "pointer",
                          color: row.label ? "#e6e6e6" : "#666",
                        }}
                        title="クリックで編集"
                      >
                        {row.label || "(未設定)"}
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{row.trades}</td>
                  <td style={{ ...td, textAlign: "right" }}>{row.fundings}</td>
                  <td style={{ ...td, textAlign: "right" }}>{row.transfers}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => saveLabel(row.id)}
                          disabled={busy === row.id}
                          style={btnPrimary}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditing((prev) => {
                              const n = { ...prev };
                              delete n[row.id];
                              return n;
                            })
                          }
                          style={btnGhost}
                        >
                          キャンセル
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => removeAccount(row)}
                        disabled={busy === row.id}
                        style={btnDanger}
                      >
                        削除
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.55rem 0.6rem",
  fontWeight: 500,
  fontSize: "0.82rem",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const td: React.CSSProperties = {
  padding: "0.6rem",
  verticalAlign: "middle",
};

const inputStyle: React.CSSProperties = {
  background: "#0f1218",
  color: "#e6e6e6",
  border: "1px solid #2a3047",
  borderRadius: 6,
  padding: "0.3rem 0.5rem",
  width: "100%",
};

const btnPrimary: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "0.3rem 0.7rem",
  cursor: "pointer",
  marginRight: 6,
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
  padding: "0.3rem 0.7rem",
  cursor: "pointer",
};
