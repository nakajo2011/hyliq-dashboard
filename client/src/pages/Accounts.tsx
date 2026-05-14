import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { pb } from "../lib/pb";
import {
  isHyperliquidAddress,
  syncFromHyperliquid,
  type SyncResult,
} from "../lib/hyperliquid";
import {
  btnDanger,
  btnDisabled,
  btnGhost,
  btnPrimary,
  COLORS,
  input as baseInput,
  lbl,
  section,
  td,
  tdRight,
  th,
} from "../styles";

// Accounts page-specific input style: same as base but stretches to fill cell.
const inputStyle: React.CSSProperties = { ...baseInput, width: "100%" };

/** "YYYY-MM-DD" for today − 7 days in JST. Used as the default sync start. */
function defaultStartDate(): string {
  const ms = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const jst = new Date(ms + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Treat "YYYY-MM-DD" as JST midnight, return epoch ms (NaN if malformed). */
function jstDateToMs(date: string): number {
  return Date.parse(`${date}T00:00:00+09:00`);
}

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

// Only `name` is editable in-place. Address is fixed at account creation
// because changing it would break the hash-based dedup (every row's hash
// includes the account-name key) and the API sync semantics. To "change" an
// address, delete and re-add the account.
type EditState = { field: "name"; value: string };

type SyncStatus =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: SyncResult }
  | { status: "error"; message: string };

export function Accounts() {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; rows: AccountRow[] }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [editing, setEditing] = useState<Record<string, EditState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [syncStates, setSyncStates] = useState<Record<string, SyncStatus>>({});
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [adding, setAdding] = useState(false);
  /** Per-row start date (YYYY-MM-DD, JST) for the sync. End = start + 7 days. */
  const [syncStartDates, setSyncStartDates] = useState<Record<string, string>>(
    {}
  );

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
    if (!value) {
      alert("アカウント名は必須です");
      return;
    }
    setBusy(id);
    try {
      await pb.collection("accounts").update(id, { name: value });
      cancelEdit(id);
      await reload();
    } catch (e) {
      alert(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleAddAccount = async () => {
    const name = newName.trim();
    const address = newAddress.trim();
    if (!name) {
      alert("アカウント名は必須です");
      return;
    }
    if (address && !isHyperliquidAddress(address)) {
      alert("アドレスは 0x で始まる 40 桁の 16 進文字列で指定してください");
      return;
    }
    setAdding(true);
    try {
      // PocketBase will 4xx if name uniqueness is violated; surface that.
      await pb
        .collection("accounts")
        .create({ name, address: address || undefined });
      setNewName("");
      setNewAddress("");
      await reload();
    } catch (e) {
      alert(`追加失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdding(false);
    }
  };

  const handleSync = async (row: AccountRow) => {
    if (!row.address) return;
    const startDate = syncStartDates[row.id] ?? defaultStartDate();
    const startTime = jstDateToMs(startDate);
    if (!Number.isFinite(startTime)) {
      alert("開始日が不正です (YYYY-MM-DD 形式で指定してください)");
      return;
    }
    const endTime = startTime + 7 * 24 * 60 * 60 * 1000;
    setSyncStates((prev) => ({ ...prev, [row.id]: { status: "running" } }));
    try {
      const result = await syncFromHyperliquid({
        accountName: row.name,
        address: row.address,
        startTime,
        endTime,
      });
      setSyncStates((prev) => ({
        ...prev,
        [row.id]: { status: "done", result },
      }));
      await reload();
    } catch (e) {
      setSyncStates((prev) => ({
        ...prev,
        [row.id]: {
          status: "error",
          message: e instanceof Error ? e.message : String(e),
        },
      }));
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

      <section style={section}>
        <h2 style={{ marginTop: 0, marginBottom: "0.6rem", fontSize: "1rem", color: COLORS.muted }}>
          新規アカウント追加
        </h2>
        <p style={{ color: COLORS.subtle, fontSize: "0.82rem", marginTop: 0, marginBottom: 12 }}>
          アドレスを登録すると、Hyperliquid 公式 API
          から直近 7 日分の取引・Funding・入出金を「同期」ボタンで取り込めます (PoC)。
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 200 }}>
            <label style={lbl}>アカウント名 (必須)</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={baseInput}
              placeholder="Main"
            />
          </div>
          <div style={{ flex: 1, minWidth: 360 }}>
            <label style={lbl}>アドレス (任意、0x... 40 桁)</label>
            <input
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              style={{ ...baseInput, width: "100%", fontFamily: "monospace" }}
              placeholder="0x0000000000000000000000000000000000000000"
            />
          </div>
          <button
            type="button"
            onClick={handleAddAccount}
            disabled={adding || !newName.trim()}
            style={adding || !newName.trim() ? btnDisabled : btnPrimary}
          >
            {adding ? "追加中..." : "追加"}
          </button>
        </div>
      </section>

      {state.status === "loading" && <p>読み込み中...</p>}
      {state.status === "error" && (
        <p style={{ color: "#ff6b6b" }}>❌ {state.message}</p>
      )}

      {state.status === "ready" && state.rows.length === 0 && (
        <p style={{ color: "#888" }}>
          まだアカウントがありません。上のフォームでアドレスを登録するか、
          <Link to="/upload">Upload</Link> から CSV を取り込むと自動で登録されます。
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
                  <td
                    style={{
                      ...td,
                      fontFamily: "monospace",
                      color: row.address ? COLORS.muted : COLORS.faint,
                    }}
                    title={
                      row.address
                        ? "アドレスは登録後に変更できません (変更には削除→再追加が必要)"
                        : "CSV 取り込みで自動作成されたアカウントのためアドレス未設定"
                    }
                  >
                    {row.address || "(未設定)"}
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
                        <SyncButton
                          row={row}
                          status={syncStates[row.id] ?? { status: "idle" }}
                          startDate={
                            syncStartDates[row.id] ?? defaultStartDate()
                          }
                          onChangeStartDate={(v) =>
                            setSyncStartDates((prev) => ({
                              ...prev,
                              [row.id]: v,
                            }))
                          }
                          onSync={() => handleSync(row)}
                        />
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

function SyncButton({
  row,
  status,
  startDate,
  onChangeStartDate,
  onSync,
}: {
  row: AccountRow;
  status: SyncStatus;
  startDate: string;
  onChangeStartDate: (v: string) => void;
  onSync: () => void;
}) {
  const hasAddress = Boolean(row.address);
  const running = status.status === "running";
  const disabled = !hasAddress || running;
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 6 }}
    >
      <input
        type="date"
        value={startDate}
        disabled={!hasAddress || running}
        onChange={(e) => onChangeStartDate(e.target.value)}
        style={{ ...baseInput, padding: "0.25rem 0.4rem", fontSize: "0.82rem" }}
        title="同期の開始日 (JST)。終了日は +7 日"
      />
      <button
        type="button"
        onClick={onSync}
        disabled={disabled}
        style={disabled ? btnDisabled : btnPrimary}
        title={
          hasAddress
            ? `${startDate} から 7 日分を Hyperliquid 公式 API から同期`
            : "アドレス未設定"
        }
      >
        {running ? "同期中..." : "同期 (+7日)"}
      </button>
      {status.status === "done" && (
        <span style={{ fontSize: "0.78rem", color: COLORS.muted }}>
          ✅ 取引 +{status.result.trades.inserted}, Funding +
          {status.result.fundings.inserted}, 入出金 +
          {status.result.transfers.inserted}
          {status.result.warnings.length > 0 && (
            <span
              title={status.result.warnings.join("\n")}
              style={{ color: COLORS.warn, marginLeft: 4 }}
            >
              ⚠️ {status.result.warnings.length}
            </span>
          )}
        </span>
      )}
      {status.status === "error" && (
        <span
          title={status.message}
          style={{ fontSize: "0.78rem", color: COLORS.neg }}
        >
          ❌ 同期失敗
        </span>
      )}
    </span>
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

