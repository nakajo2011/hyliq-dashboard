import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { pb } from "../lib/pb";
import { AccountCreateModal } from "../components/AccountCreateModal";
import { AccountCsvImportModal } from "../components/AccountCsvImportModal";
import { AccountSyncModal } from "../components/AccountSyncModal";
import {
  btnGhost,
  btnGhostDisabled,
  btnPrimary,
  COLORS,
  input as baseInput,
  td,
  tdRight,
  th,
} from "../styles";

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

/** Abbreviate a 0x… address for table display; full value goes in `title`. */
function shortAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

const iconDangerBtn: CSSProperties = {
  background: "transparent",
  border: `1px solid ${COLORS.dangerBorder}`,
  borderRadius: 6,
  padding: "0.35rem 0.45rem",
  cursor: "pointer",
  color: COLORS.neg,
  display: "inline-flex",
  alignItems: "center",
};

function TrashIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

type ModalState =
  | { type: "create" }
  | { type: "sync"; account: AccountRow }
  | { type: "csv"; account: AccountRow };

export function Accounts() {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; rows: AccountRow[] }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);

  // Inline account-name editing.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  // Set just before blur when the user pressed Escape, so the shared blur
  // handler can tell "cancel" apart from "commit".
  const escapeRef = useRef(false);

  const reload = async () => {
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

  const startNameEdit = (row: AccountRow) => {
    escapeRef.current = false;
    setEditValue(row.name);
    setEditingId(row.id);
  };

  const commitName = async (id: string, original: string) => {
    if (escapeRef.current) {
      escapeRef.current = false;
      setEditingId(null);
      return;
    }
    const value = editValue.trim();
    setEditingId(null);
    if (!value || value === original) return;
    try {
      await pb.collection("accounts").update(id, { name: value });
      await reload();
    } catch (e) {
      alert(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0 }}>アカウント</h1>
        <button
          type="button"
          onClick={() => setModal({ type: "create" })}
          style={btnPrimary}
        >
          ＋ 新規追加
        </button>
      </div>
      <p style={{ color: "#888" }}>
        アカウントを登録し、各行の「同期」または「CSV取込」で取引データを
        取得します。アカウント名はクリックで編集できます。各アカウントの収支は{" "}
        <Link to="/" style={{ color: "#6cf" }}>
          収支
        </Link>{" "}
        ページで確認できます。
      </p>

      {state.status === "loading" && <p>読み込み中...</p>}
      {state.status === "error" && (
        <p style={{ color: "#ff6b6b" }}>❌ {state.message}</p>
      )}

      {state.status === "ready" && state.rows.length === 0 && (
        <p style={{ color: "#888", marginTop: "2rem" }}>
          まだアカウントがありません。右上の「＋ 新規追加」から作成してください。
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
              <th style={th}>アドレス</th>
              <th style={tdRight}>取引</th>
              <th style={tdRight}>ファンディング</th>
              <th style={tdRight}>入出金</th>
              <th style={{ ...th, textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row) => {
              const hasAddress = Boolean(row.address);
              return (
                <tr key={row.id} style={{ borderBottom: "1px solid #1a1f2c" }}>
                  <td style={td}>
                    {editingId === row.id ? (
                      <input
                        autoFocus
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") {
                            escapeRef.current = true;
                            e.currentTarget.blur();
                          }
                        }}
                        onBlur={() => commitName(row.id, row.name)}
                        style={{
                          ...baseInput,
                          width: "100%",
                          padding: "0.3rem 0.5rem",
                        }}
                      />
                    ) : (
                      <span
                        onClick={() => startNameEdit(row)}
                        title="クリックして名前を編集"
                        style={{
                          color: COLORS.text,
                          fontWeight: 500,
                          cursor: "pointer",
                          borderBottom: "1px dotted #555",
                        }}
                      >
                        {row.name}
                      </span>
                    )}
                  </td>
                  <td
                    style={{
                      ...td,
                      fontFamily: "monospace",
                      color: hasAddress ? COLORS.muted : COLORS.faint,
                    }}
                    title={
                      hasAddress
                        ? row.address
                        : "アドレス未設定 (CSV取込のみ利用可)"
                    }
                  >
                    {hasAddress ? shortAddress(row.address) : "(未設定)"}
                  </td>
                  <td style={tdRight}>{row.trades}</td>
                  <td style={tdRight}>{row.fundings}</td>
                  <td style={tdRight}>{row.transfers}</td>
                  <td style={tdRight}>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        justifyContent: "flex-end",
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setModal({ type: "sync", account: row })}
                        disabled={!hasAddress}
                        style={hasAddress ? btnGhost : btnGhostDisabled}
                        title={
                          hasAddress
                            ? "Hyperliquid 公式 API から同期"
                            : "アドレス未設定のため同期できません"
                        }
                      >
                        同期
                      </button>
                      <button
                        type="button"
                        onClick={() => setModal({ type: "csv", account: row })}
                        style={btnGhost}
                        title="このアカウントに CSV を取り込む"
                      >
                        CSV取込
                      </button>
                      <button
                        type="button"
                        onClick={() => removeAccount(row)}
                        disabled={busy === row.id}
                        style={iconDangerBtn}
                        title="このアカウントを削除"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {modal?.type === "create" && (
        <AccountCreateModal
          onClose={() => setModal(null)}
          onCreated={reload}
        />
      )}
      {modal?.type === "sync" && (
        <AccountSyncModal
          accountName={modal.account.name}
          address={modal.account.address}
          onClose={() => setModal(null)}
          onSynced={reload}
        />
      )}
      {modal?.type === "csv" && (
        <AccountCsvImportModal
          accountName={modal.account.name}
          onClose={() => setModal(null)}
          onImported={reload}
        />
      )}
    </div>
  );
}
