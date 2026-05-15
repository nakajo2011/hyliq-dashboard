import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { pb } from "../lib/pb";
import { AccountCsvImportModal } from "../components/AccountCsvImportModal";
import { AccountFormModal } from "../components/AccountFormModal";
import { AccountSyncModal } from "../components/AccountSyncModal";
import {
  btnDanger,
  btnGhost,
  btnGhostDisabled,
  btnPrimary,
  COLORS,
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

type ModalState =
  | { type: "create" }
  | { type: "edit"; account: AccountRow }
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
        取得します。各アカウントの収支は{" "}
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
                  <td style={{ ...td, color: COLORS.text, fontWeight: 500 }}>
                    {row.name}
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
                        onClick={() => setModal({ type: "edit", account: row })}
                        style={btnGhost}
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => removeAccount(row)}
                        disabled={busy === row.id}
                        style={btnDanger}
                      >
                        削除
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
        <AccountFormModal
          onClose={() => setModal(null)}
          onSaved={reload}
        />
      )}
      {modal?.type === "edit" && (
        <AccountFormModal
          account={modal.account}
          onClose={() => setModal(null)}
          onSaved={reload}
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
