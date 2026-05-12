import type { CsvKind } from "./types";

const ADDRESS_RE = /(0x[0-9a-fA-F]{40})/;

export interface DetectionResult {
  kind: CsvKind | null;
  detectedAddress?: string;
  reason: string;
}

/**
 * Detect CSV kind from filename first (cheap), then fall back to header
 * inspection if filename is ambiguous.
 */
export function detectCsvKind(
  filename: string,
  headerRow?: string[]
): DetectionResult {
  const lower = filename.toLowerCase();

  if (lower.includes("trade_history")) {
    const m = filename.match(ADDRESS_RE);
    return {
      kind: "trade",
      detectedAddress: m ? m[1] : undefined,
      reason: m
        ? `ファイル名に取引履歴とアドレス (${m[1]}) を検出`
        : "ファイル名から取引履歴として検出 (アドレスは別途指定が必要)",
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
