import { useState } from "react";
import { syncFromHyperliquid, type SyncResult } from "../lib/hyperliquid";
import {
  btnDisabled,
  btnPrimary,
  COLORS,
  input as baseInput,
  lbl,
} from "../styles";
import { Modal } from "./Modal";

/** "YYYY-MM" for the current month in JST. */
function defaultSyncMonth(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Map "YYYY-MM" to [start, end) JST ms boundaries — start = the 1st at
 * 00:00 JST, end = the following month's 1st at 00:00 JST (exclusive).
 */
function monthToRangeMs(
  yyyymm: string
): { startMs: number; endMs: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const startMs = Date.parse(`${yyyymm}-01T00:00:00+09:00`);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMm = String(nextMonth).padStart(2, "0");
  const endMs = Date.parse(`${nextYear}-${nextMm}-01T00:00:00+09:00`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startMs, endMs };
}

type SyncStatus =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: SyncResult }
  | { status: "error"; message: string };

/**
 * Sync trades / funding / transfers for a single account from the
 * Hyperliquid public API, one calendar month at a time.
 */
export function AccountSyncModal({
  accountName,
  address,
  onClose,
  onSynced,
}: {
  accountName: string;
  address: string;
  onClose: () => void;
  onSynced: () => void;
}) {
  const [month, setMonth] = useState(defaultSyncMonth());
  const [status, setStatus] = useState<SyncStatus>({ status: "idle" });
  const running = status.status === "running";

  const handleSync = async () => {
    const range = monthToRangeMs(month);
    if (!range) {
      setStatus({ status: "error", message: "対象月が不正です" });
      return;
    }
    setStatus({ status: "running" });
    try {
      const result = await syncFromHyperliquid({
        accountName,
        address,
        startTime: range.startMs,
        endTime: range.endMs,
      });
      setStatus({ status: "done", result });
      onSynced();
    } catch (e) {
      setStatus({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <Modal
      title={
        <>
          データ同期{" "}
          <span style={{ color: COLORS.muted, fontWeight: 400 }}>
            — {accountName}
          </span>
        </>
      }
      onClose={onClose}
    >
      <p style={{ color: COLORS.subtle, fontSize: "0.85rem", marginTop: 0 }}>
        Hyperliquid 公式 API
        から、指定した月の取引・ファンディング・入出金を取得します。
      </p>
      <div
        style={{
          fontSize: "0.82rem",
          color: COLORS.muted,
          marginBottom: 14,
          fontFamily: "monospace",
          wordBreak: "break-all",
        }}
      >
        {address}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>対象月 (JST、月初〜翌月初)</label>
        <input
          type="month"
          value={month}
          disabled={running}
          onChange={(e) => setMonth(e.target.value)}
          style={baseInput}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={handleSync}
          disabled={running}
          style={running ? btnDisabled : btnPrimary}
        >
          {running ? "同期中..." : "同期"}
        </button>
      </div>

      {status.status === "done" && (
        <div
          style={{
            marginTop: 14,
            padding: "0.9rem",
            background: "#15281c",
            border: "1px solid #2d5a3d",
            borderRadius: 8,
          }}
        >
          <strong style={{ color: COLORS.pos }}>✅ 同期完了</strong>
          <ul
            style={{
              margin: "6px 0 0",
              paddingLeft: "1.2rem",
              fontSize: "0.9rem",
            }}
          >
            <li>
              取引: 新規 {status.result.trades.inserted} 件 / 重複{" "}
              {status.result.trades.skippedDuplicates} 件
            </li>
            <li>
              ファンディング: 新規 {status.result.fundings.inserted} 件 / 重複{" "}
              {status.result.fundings.skippedDuplicates} 件
            </li>
            <li>
              入出金: 新規 {status.result.transfers.inserted} 件 / 重複{" "}
              {status.result.transfers.skippedDuplicates} 件
            </li>
          </ul>
          {status.result.warnings.length > 0 && (
            <ul
              style={{
                margin: "8px 0 0",
                paddingLeft: "1.2rem",
                fontSize: "0.82rem",
                color: COLORS.warn,
              }}
            >
              {status.result.warnings.map((w) => (
                <li key={w}>⚠️ {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {status.status === "error" && (
        <p style={{ color: COLORS.neg, fontSize: "0.85rem", marginTop: 12 }}>
          ❌ {status.message}
        </p>
      )}
    </Modal>
  );
}
