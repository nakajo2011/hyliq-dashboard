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

/**
 * Create a new account. Name is required; address is optional and can only
 * be set here (it is immutable afterwards — changing it would break
 * hash-based dedup and API sync). The account name is edited inline in the
 * list, so there is no edit mode here.
 */
export function AccountCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const n = name.trim();
    const a = address.trim();
    if (!n) {
      setError("アカウント名は必須です");
      return;
    }
    if (a && !isHyperliquidAddress(a)) {
      setError("アドレスは 0x で始まる 40 桁の 16 進文字列で指定してください");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await pb
        .collection("accounts")
        .create({ name: n, address: a || undefined });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="新規アカウント" onClose={onClose}>
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
        <label style={lbl}>アドレス (任意、0x... 40 桁)</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          style={{ ...baseInput, width: "100%", fontFamily: "monospace" }}
          placeholder="0x0000000000000000000000000000000000000000"
        />
        <p
          style={{
            color: COLORS.subtle,
            fontSize: "0.8rem",
            marginTop: 6,
            marginBottom: 0,
          }}
        >
          アドレスを登録するとデータ同期 (Hyperliquid 公式 API)
          が使えます。後から変更はできません。
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
          {busy ? "追加中..." : "追加"}
        </button>
      </div>
    </Modal>
  );
}
