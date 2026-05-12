import type { CsvKind } from "./types";

export interface DetectionResult {
  kind: CsvKind | null;
  reason: string;
}

/**
 * Detect CSV kind from filename first (cheap), then fall back to header
 * inspection if filename is ambiguous.
 *
 * Account name is always supplied separately by the user — we no longer try
 * to extract an address from the filename.
 */
export function detectCsvKind(
  filename: string,
  headerRow?: string[]
): DetectionResult {
  const lower = filename.toLowerCase();

  if (lower.includes("trade_history")) {
    return {
      kind: "trade",
      reason: "ファイル名から取引履歴として検出",
    };
  }
  if (lower.includes("funding_history")) {
    return {
      kind: "funding",
      reason: "ファイル名からファンディング履歴として検出",
    };
  }
  if (lower.includes("deposits_and_withdrawals")) {
    return {
      kind: "transfer",
      reason: "ファイル名から入出金履歴として検出",
    };
  }

  if (headerRow) {
    const headers = headerRow.map((h) => h.trim());
    const hs = new Set(headers);
    if (hs.has("dir") && hs.has("closedPnl")) {
      return { kind: "trade", reason: "ヘッダから取引履歴として検出" };
    }
    if (hs.has("payment") && hs.has("rate") && hs.has("side")) {
      return { kind: "funding", reason: "ヘッダからファンディング履歴として検出" };
    }
    if (hs.has("accountValueChange")) {
      return { kind: "transfer", reason: "ヘッダから入出金履歴として検出" };
    }
  }

  return { kind: null, reason: "種別を判定できませんでした" };
}
