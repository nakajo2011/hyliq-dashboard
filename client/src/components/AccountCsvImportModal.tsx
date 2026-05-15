import { useEffect, useState } from "react";
import { Dropzone } from "./Dropzone";
import { StagedFileCard, type StagedFile } from "./StagedFileCard";
import {
  detectCsvKind,
  parseFundingCsv,
  parseTradeCsv,
  parseTransferCsv,
  type CsvKind,
  type ParsedRow,
} from "../lib/csv";
import { commitGroup, type CommitGroupResult } from "../lib/persistence";
import { btnGhost, btnPrimary, COLORS } from "../styles";

type RawFile = StagedFile & { rawText: string };

async function parseWithAccount(
  rawText: string,
  kind: CsvKind,
  accountName: string
) {
  if (kind === "trade") return parseTradeCsv(rawText, accountName);
  if (kind === "funding") return parseFundingCsv(rawText, accountName);
  return parseTransferCsv(rawText, accountName);
}

type CommitState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; results: CommitGroupResult[] }
  | { status: "error"; message: string };

const KIND_LABEL: Record<CsvKind, string> = {
  trade: "取引",
  funding: "ファンディング",
  transfer: "入出金",
};

/**
 * CSV import scoped to a single, already-registered account. The account is
 * fixed by the caller, so dropped files are parsed and committed straight to
 * that account — no per-file account picker.
 */
export function AccountCsvImportModal({
  accountName,
  onClose,
  onImported,
}: {
  accountName: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [files, setFiles] = useState<RawFile[]>([]);
  const [commitState, setCommitState] = useState<CommitState>({
    status: "idle",
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleFiles = async (incoming: File[]) => {
    const next: RawFile[] = await Promise.all(
      incoming.map(async (file) => {
        const id = `${file.name}-${file.lastModified}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        const text = await file.text();

        let headerRow: string[] | undefined;
        const firstLine = text.split(/\r?\n/, 1)[0];
        if (firstLine) headerRow = firstLine.split(",").map((s) => s.trim());

        const detection = detectCsvKind(file.name, headerRow);
        const base: RawFile = {
          id,
          filename: file.name,
          size: file.size,
          rawText: text,
          kind: detection.kind,
          detectionReason: detection.reason,
          accountName,
          rows: [],
          parseErrors: [],
          status: "ready",
        };

        if (!detection.kind) {
          return {
            ...base,
            status: "error",
            errorMessage: "CSV の種別を判定できません",
          };
        }
        try {
          const result = await parseWithAccount(
            text,
            detection.kind,
            accountName
          );
          return {
            ...base,
            rows: result.rows,
            parseErrors: result.errors,
            status: "ready",
          };
        } catch (e) {
          return {
            ...base,
            status: "error",
            errorMessage: e instanceof Error ? e.message : String(e),
          };
        }
      })
    );
    setFiles((prev) => [...prev, ...next]);
  };

  const handleRemove = (id: string) =>
    setFiles((prev) => prev.filter((f) => f.id !== id));

  const handleCommit = async () => {
    setCommitState({ status: "running" });
    try {
      const ready = files.filter((f) => f.status === "ready" && f.kind);
      const byKind = new Map<CsvKind, ParsedRow[]>();
      for (const f of ready) {
        if (!f.kind) continue;
        const arr = byKind.get(f.kind) ?? [];
        arr.push(...f.rows);
        byKind.set(f.kind, arr);
      }

      const results: CommitGroupResult[] = [];
      for (const [kind, rows] of byKind) {
        results.push(await commitGroup(accountName, kind, rows));
      }

      setCommitState({ status: "done", results });
      setFiles([]);
      onImported();
    } catch (e) {
      setCommitState({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const readyCount = files.filter((f) => f.status === "ready").length;
  const totalRows = files.reduce(
    (sum, f) => (f.status === "ready" ? sum + f.rows.length : sum),
    0
  );
  const committing = commitState.status === "running";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "3rem 1rem",
        zIndex: 100,
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.bg,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 10,
          padding: "1.5rem",
          width: "100%",
          maxWidth: 640,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "1rem",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
            CSV取込{" "}
            <span style={{ color: COLORS.muted, fontWeight: 400 }}>
              — {accountName}
            </span>
          </h2>
          <button type="button" onClick={onClose} style={btnGhost}>
            閉じる
          </button>
        </div>
        <p
          style={{
            color: COLORS.subtle,
            fontSize: "0.85rem",
            marginTop: 8,
            marginBottom: 14,
          }}
        >
          Hyperliquid からエクスポートした CSV
          (取引履歴・ファンディング・入出金) をこのアカウントに取り込みます。
        </p>

        <Dropzone onFiles={handleFiles} />

        {commitState.status === "error" && (
          <div
            style={{
              marginTop: "1rem",
              padding: "0.8rem",
              background: "#3b1d1d",
              border: "1px solid #6b2a2a",
              borderRadius: 8,
              color: "#ffb3b3",
            }}
          >
            ❌ 保存中にエラー: {commitState.message}
          </div>
        )}

        {commitState.status === "done" && (
          <div
            style={{
              marginTop: "1rem",
              padding: "1rem",
              background: "#15281c",
              border: "1px solid #2d5a3d",
              borderRadius: 8,
            }}
          >
            <strong style={{ color: "#5dd58c" }}>✅ 保存完了</strong>
            <ul style={{ marginTop: "0.5rem", marginBottom: 0 }}>
              {commitState.results.map((r) => (
                <li
                  key={`${r.accountId}-${r.kind}`}
                  style={{ fontSize: "0.92rem", marginTop: 6 }}
                >
                  {KIND_LABEL[r.kind]}: 新規 {r.inserted} 件、重複スキップ{" "}
                  {r.skippedDuplicates} 件
                  {r.failed > 0 && (
                    <span style={{ color: "#ff6b6b" }}>
                      {" "}
                      / 失敗 {r.failed} 件
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {files.length > 0 && (
          <div style={{ marginTop: "1.4rem" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h3
                style={{ margin: 0, fontSize: "0.95rem", color: COLORS.muted }}
              >
                ステージング中のファイル
              </h3>
              <button
                type="button"
                disabled={readyCount === 0 || committing}
                onClick={handleCommit}
                style={{
                  ...btnPrimary,
                  ...(readyCount === 0 || committing
                    ? { background: COLORS.border, color: COLORS.faint, cursor: "not-allowed" }
                    : {}),
                }}
              >
                {committing
                  ? "保存中..."
                  : `DB に保存 (${readyCount} ファイル / ${totalRows} 行)`}
              </button>
            </div>
            {files.map((f) => (
              <StagedFileCard key={f.id} file={f} onRemove={handleRemove} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
