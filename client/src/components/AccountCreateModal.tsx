import { useRef, useState } from "react";
import { pb } from "../lib/pb";
import { isHyperliquidAddress } from "../lib/hyperliquid";
import { decodeQrAddress } from "../lib/qr";
import {
  btnDisabled,
  btnGhost,
  btnPrimary,
  COLORS,
  input as baseInput,
  lbl,
} from "../styles";
import { ImageIcon } from "./icons";
import { Modal } from "./Modal";

type QrStatus =
  | { status: "idle" }
  | { status: "decoding" }
  | { status: "ok" }
  | { status: "error"; message: string };

/**
 * Create a new account. Name is required; address is optional and can only
 * be set here (it is immutable afterwards — changing it would break
 * hash-based dedup and API sync). The address can be typed or read from an
 * uploaded QR code image. The account name is edited inline in the list, so
 * there is no edit mode here.
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
  const [qr, setQr] = useState<QrStatus>({ status: "idle" });
  const qrInputRef = useRef<HTMLInputElement>(null);

  const handleQrFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setQr({ status: "decoding" });
    try {
      const addr = await decodeQrAddress(file);
      if (addr) {
        setAddress(addr);
        setQr({ status: "ok" });
      } else {
        setQr({
          status: "error",
          message: "QRコードからアドレスを読み取れませんでした",
        });
      }
    } catch (err) {
      setQr({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 8,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={() => qrInputRef.current?.click()}
            disabled={qr.status === "decoding"}
            style={{
              ...btnGhost,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ImageIcon size={14} />
            QRコード画像から読み取り
          </button>
          <input
            ref={qrInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleQrFile}
          />
          {qr.status === "decoding" && (
            <span style={{ color: COLORS.muted, fontSize: "0.82rem" }}>
              読み取り中...
            </span>
          )}
          {qr.status === "ok" && (
            <span style={{ color: COLORS.pos, fontSize: "0.82rem" }}>
              ✅ 読み取りました
            </span>
          )}
          {qr.status === "error" && (
            <span style={{ color: COLORS.neg, fontSize: "0.82rem" }}>
              ❌ {qr.message}
            </span>
          )}
        </div>
        <p
          style={{
            color: COLORS.subtle,
            fontSize: "0.8rem",
            marginTop: 8,
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
