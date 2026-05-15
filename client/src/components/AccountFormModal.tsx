import { useState } from "react";
import { pb } from "../lib/pb";
import { isHyperliquidAddress } from "../lib/hyperliquid";
import {
  btnDisabled,
  btnPrimary,
  COLORS,
  input as baseInput,
  lbl,
} from "../styles";
import { Modal } from "./Modal";

export interface EditableAccount {
  id: string;
  name: string;
  address: string;
}

/**
 * Create a new account, or edit an existing one's name. Address is only
 * settable at creation — for an existing account it is shown read-only,
 * since changing it would break hash-based dedup and API sync.
 */
export function AccountFormModal({
  account,
  onClose,
  onSaved,
}: {
  /** Provide for edit mode; omit for create mode. */
  account?: EditableAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = account != null;
  const [name, setName] = useState(account?.name ?? "");
  const [address, setAddress] = useState(account?.address ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const n = name.trim();
    const a = address.trim();
    if (!n) {
      setError("アカウント名は必須です");
      return;
    }
    if (!isEdit && a && !isHyperliquidAddress(a)) {
      setError("アドレスは 0x で始まる 40 桁の 16 進文字列で指定してください");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isEdit) {
        await pb.collection("accounts").update(account.id, { name: n });
      } else {
        await pb
          .collection("accounts")
          .create({ name: n, address: a || undefined });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? "アカウントを編集" : "新規アカウント"}
      onClose={onClose}
    >
      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>アカウント名 (必須)</label>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          style={{ ...baseInput, width: "100%" }}
          placeholder="Main"
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>
          アドレス{isEdit ? " (変更不可)" : " (任意、0x... 40 桁)"}
        </label>
        {isEdit ? (
          <div
            style={{
              ...baseInput,
              width: "100%",
              fontFamily: "monospace",
              color: account.address ? COLORS.muted : COLORS.faint,
            }}
          >
            {account.address || "(未設定)"}
          </div>
        ) : (
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            style={{ ...baseInput, width: "100%", fontFamily: "monospace" }}
            placeholder="0x0000000000000000000000000000000000000000"
          />
        )}
        <p
          style={{
            color: COLORS.subtle,
            fontSize: "0.8rem",
            marginTop: 6,
            marginBottom: 0,
          }}
        >
          {isEdit
            ? "アドレスは登録後に変更できません (変更には削除→再追加が必要)。"
            : "アドレスを登録するとデータ同期 (Hyperliquid 公式 API) が使えます。後から変更はできません。"}
        </p>
      </div>

      {error && (
        <p style={{ color: COLORS.neg, fontSize: "0.85rem" }}>❌ {error}</p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || !name.trim()}
          style={busy || !name.trim() ? btnDisabled : btnPrimary}
        >
          {busy ? "保存中..." : isEdit ? "保存" : "追加"}
        </button>
      </div>
    </Modal>
  );
}
