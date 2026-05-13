import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { pb } from "../lib/pb";
import {
  btnDanger,
  btnGhost,
  btnPrimary,
  input as baseInput,
  td,
  tdRight,
  th,
} from "../styles";

// Accounts page-specific input style: same as base but stretches to fill cell.
const inputStyle: React.CSSProperties = { ...baseInput, width: "100%" };

interface AccountRow {
  id: string;
  name: string;
  address: string;
  note: string;
  trades: number;
  fundings: number;
  transfers: number;
}

interface RawAccount {
  id: string;
  name: string;
  address?: string;
  note?: string;
}

async function fetchAccountsWithCounts(): Promise<AccountRow[]> {
  const accounts = await pb
    .collection("accounts")
    .getFullList<RawAccount>({ sort: "name" });

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
        name: a.name,
        address: a.address ?? "",
        note: a.note ?? "",
        trades,
        fundings,
        transfers,
      };
    })
  );
  return rows;
}

type EditState =
  | { field: "name"; value: string }
  | { field: "address"; value: string };

export function Accounts() {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; rows: AccountRow[] }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [editing, setEditing] = useState<Record<string, EditState>>({});
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

  const startEdit = (id: string, field: EditState["field"], value: string) => {
    setEditing((prev) => ({ ...prev, [id]: { field, value } }));
  };
  const cancelEdit = (id: string) => {
    setEditing((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
  };
  const save = async (id: string) => {
    const cur = editing[id];
    if (!cur) return;
    const value = cur.value.trim();
    if (cur.field === "name" && !value) {
      alert("アカウント名は必須です");
      return;
    }
    setBusy(id);
    try {
      await pb.collection("accounts").update(id, { [cur.field]: value });
      cancelEdit(id);
      await reload();
    } catch (e) {
      alert(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const removeAccount = async (row: AccountRow) => {
    const total = row.trades + row.fundings + row.transfers;
    const label = row.name || row.address || row.id;
    const msg =
      total > 0
        ? `${label}\n\n関連データ ${total} 件も全て削除されます。本当に削除しますか？`
        : `${label}\n\nこのアカウントを削除しますか？`;
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
        登録済みアカウント一覧。アカウント名・アドレスはクリックで編集できます。削除時は関連データ
        (trades / fundings / transfers) も cascade で削除されます。
      </p>

      {state.status === "loading" && <p>読み込み中...</p>}
      {state.status === "error" && (
        <p style={{ color: "#ff6b6b" }}>❌ {state.message}</p>
      )}

      {state.status === "ready" && state.rows.length === 0 && (
        <p style={{ color: "#888" }}>
          まだアカウントがありません。<Link to="/upload">Upload</Link>{" "}
          から CSV を取り込むと自動で登録されます。
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
              <th style={th}>アカウント名</th>
              <th style={th}>アドレス (任意)</th>
              <th style={{ ...th, textAlign: "right" }}>Trades</th>
              <th style={{ ...th, textAlign: "right" }}>Fundings</th>
              <th style={{ ...th, textAlign: "right" }}>Transfers</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row) => {
              const edit = editing[row.id];
              const editingName = edit?.field === "name";
              const editingAddress = edit?.field === "address";
              return (
                <tr key={row.id} style={{ borderBottom: "1px solid #1a1f2c" }}>
                  <td style={td}>
                    {editingName ? (
                      <EditCell
                        value={edit.value}
                        onChange={(v) =>
                          setEditing((prev) => ({
                            ...prev,
                            [row.id]: { field: "name", value: v },
                          }))
                        }
                        onSave={() => save(row.id)}
                        onCancel={() => cancelEdit(row.id)}
                      />
                    ) : (
                      <Link
                        to={`/accounts/${row.id}`}
                        style={{
                          color: "#6cf",
                          textDecoration: "none",
                          fontWeight: 500,
                        }}
                      >
                        {row.name}
                      </Link>
                    )}
                  </td>
                  <td style={{ ...td, fontFamily: "monospace" }}>
                    {editingAddress ? (
                      <EditCell
                        value={edit.value}
                        onChange={(v) =>
                          setEditing((prev) => ({
                            ...prev,
                            [row.id]: { field: "address", value: v },
                          }))
                        }
                        onSave={() => save(row.id)}
                        onCancel={() => cancelEdit(row.id)}
                      />
                    ) : (
                      <span
                        onClick={() => startEdit(row.id, "address", row.address)}
                        style={{
                          cursor: "pointer",
                          color: row.address ? "#aab" : "#555",
                        }}
                        title="クリックで編集"
                      >
                        {row.address || "(未設定)"}
                      </span>
                    )}
                  </td>
                  <td style={tdRight}>{row.trades}</td>
                  <td style={tdRight}>{row.fundings}</td>
                  <td style={tdRight}>{row.transfers}</td>
                  <td style={tdRight}>
                    {edit ? (
                      <>
                        <button
                          type="button"
                          onClick={() => save(row.id)}
                          disabled={busy === row.id}
                          style={btnPrimary}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => cancelEdit(row.id)}
                          style={btnGhost}
                        >
                          キャンセル
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => startEdit(row.id, "name", row.name)}
                          style={btnGhost}
                        >
                          名前を編集
                        </button>
                        <button
                          type="button"
                          onClick={() => removeAccount(row)}
                          disabled={busy === row.id}
                          style={btnDanger}
                        >
                          削除
                        </button>
                      </>
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

function EditCell({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSave();
        if (e.key === "Escape") onCancel();
      }}
      style={inputStyle}
    />
  );
}

