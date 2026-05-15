import { useEffect, useId, useState } from "react";
import { Dropzone } from "./Dropzone";
import { StagedFileCard, type StagedFile } from "./StagedFileCard";
import { pb } from "../lib/pb";
import {
  detectCsvKind,
  parseFundingCsv,
  parseTradeCsv,
  parseTransferCsv,
  type CsvKind,
  type ParsedRow,
} from "../lib/csv";
import { commitGroup, type CommitGroupResult } from "../lib/persistence";
import { COLORS, h2, section } from "../styles";

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

interface ExistingAccount {
  id: string;
  name: string;
}

/**
 * CSV import as an embeddable section of the アカウント settings page
 * (was a standalone page). `onImported` lets the host page refresh its
 * account list after a successful commit.
 */
export function CsvImportSection({
  onImported,
}: {
  onImported?: () => void;
}) {
  const [files, setFiles] = useState<RawFile[]>([]);
  const [commitState, setCommitState] = useState<CommitState>({
    status: "idle",
  });
  const [existingAccounts, setExistingAccounts] = useState<ExistingAccount[]>(
    []
  );
  const datalistId = useId();

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const list = await pb
          .collection("accounts")
          .getFullList<ExistingAccount>({ sort: "name", fields: "id,name" });
        if (!cancelled) setExistingAccounts(list);
      } catch {
        // It's fine if this fails — the combobox just won't have suggestions.
      }
    };
    refresh();
    return () => {
      cancelled = true;
    };
  }, [commitState.status]);

  const existingNames = existingAccounts.map((a) => a.name);

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
          accountName: "",
          rows: [],
          parseErrors: [],
          status: "needs-account",
        };

        if (!detection.kind) {
          return {
            ...base,
            status: "error",
            errorMessage: "CSV の種別を判定できません",
          };
        }

        return base;
      })
    );
    setFiles((prev) => [...prev, ...next]);
  };

  const handleChangeAccountName = async (id: string, accountName: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, accountName } : f))
    );

    const current = files.find((f) => f.id === id);
    if (!current || !current.kind) return;

    if (!accountName.trim()) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                accountName,
                status: "needs-account",
                rows: [],
                parseErrors: [],
                errorMessage: undefined,
              }
            : f
        )
      );
      return;
    }

    try {
      const result = await parseWithAccount(
        current.rawText,
        current.kind,
        accountName
      );
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                accountName,
                rows: result.rows,
                parseErrors: result.errors,
                status: "ready",
                errorMessage: undefined,
              }
            : f
        )
      );
    } catch (e) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                accountName,
                status: "error",
                errorMessage: e instanceof Error ? e.message : String(e),
              }
            : f
        )
      );
    }
  };

  const handleRemove = (id: string) =>
    setFiles((prev) => prev.filter((f) => f.id !== id));

  const handleCommit = async () => {
    setCommitState({ status: "running" });
    try {
      const ready = files.filter((f) => f.status === "ready" && f.kind);
      const groups = new Map<
        string,
        { kind: CsvKind; accountName: string; rows: ParsedRow[] }
      >();
      for (const f of ready) {
        if (!f.kind) continue;
        const key = `${f.kind}::${f.accountName.trim().toLowerCase()}`;
        const entry = groups.get(key) ?? {
          kind: f.kind,
          accountName: f.accountName.trim(),
          rows: [],
        };
        entry.rows.push(...f.rows);
        groups.set(key, entry);
      }

      const results: CommitGroupResult[] = [];
      for (const g of groups.values()) {
        const res = await commitGroup(g.accountName, g.kind, g.rows);
        results.push(res);
      }

      setCommitState({ status: "done", results });
      setFiles([]);
      onImported?.();
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

  return (
    <section style={section}>
      <h2 style={h2}>CSV取込</h2>
      <p
        style={{
          color: COLORS.subtle,
          fontSize: "0.85rem",
          marginTop: 0,
          marginBottom: 12,
        }}
      >
        Hyperliquid からエクスポートした CSV を取り込みます。既存アカウントへの
        追記、または新規アカウントの登録ができます。
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
                <strong>{r.accountName}</strong> / {KIND_LABEL[r.kind]}: 新規{" "}
                {r.inserted} 件、重複スキップ {r.skippedDuplicates} 件
                {r.failed > 0 && (
                  <span style={{ color: "#ff6b6b" }}> / 失敗 {r.failed} 件</span>
                )}
                {r.errors.length > 0 && (
                  <details style={{ marginTop: 4 }}>
                    <summary
                      style={{
                        cursor: "pointer",
                        color: "#ff8c8c",
                        fontSize: "0.85rem",
                      }}
                    >
                      失敗の詳細 ({r.errors.length} 件)
                    </summary>
                    <ul
                      style={{
                        marginTop: 4,
                        marginBottom: 0,
                        fontSize: "0.8rem",
                        color: "#ffb3b3",
                        fontFamily: "monospace",
                      }}
                    >
                      {r.errors.slice(0, 10).map((err) => (
                        <li key={err.hash}>
                          {err.hash.slice(0, 8)}…: {err.message}
                        </li>
                      ))}
                      {r.errors.length > 10 && (
                        <li>...他 {r.errors.length - 10} 件</li>
                      )}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {files.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "0.95rem", color: COLORS.muted }}>
              ステージング中のファイル
            </h3>
            <button
              type="button"
              disabled={readyCount === 0 || commitState.status === "running"}
              onClick={handleCommit}
              style={{
                background:
                  readyCount > 0 && commitState.status !== "running"
                    ? "#2563eb"
                    : "#2a3047",
                color:
                  readyCount > 0 && commitState.status !== "running"
                    ? "#fff"
                    : "#666",
                border: "none",
                borderRadius: 6,
                padding: "0.5rem 1rem",
                cursor:
                  readyCount > 0 && commitState.status !== "running"
                    ? "pointer"
                    : "not-allowed",
              }}
            >
              {commitState.status === "running"
                ? "保存中..."
                : `DB に保存 (${readyCount} ファイル / ${totalRows} 行)`}
            </button>
          </div>

          {/* Shared datalist for all combobox inputs */}
          <datalist id={datalistId}>
            {existingAccounts.map((a) => (
              <option key={a.id} value={a.name} />
            ))}
          </datalist>

          {files.map((f) => (
            <StagedFileCard
              key={f.id}
              file={f}
              existingNames={existingNames}
              datalistId={datalistId}
              onChangeAccountName={handleChangeAccountName}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </section>
  );
}
