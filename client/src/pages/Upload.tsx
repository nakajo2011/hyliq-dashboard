import { useState } from "react";
import { Dropzone } from "../components/Dropzone";
import { StagedFileCard, type StagedFile } from "../components/StagedFileCard";
import {
  detectCsvKind,
  parseFundingCsv,
  parseTradeCsv,
  parseTransferCsv,
  type CsvKind,
  type ParsedRow,
} from "../lib/csv";
import { commitGroup, type CommitGroupResult } from "../lib/persistence";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

type RawFile = StagedFile & { rawText: string };

async function parseWithAddress(
  rawText: string,
  kind: CsvKind,
  address: string
) {
  if (kind === "trade") return parseTradeCsv(rawText, address);
  if (kind === "funding") return parseFundingCsv(rawText, address);
  return parseTransferCsv(rawText, address);
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

export function Upload() {
  const [files, setFiles] = useState<RawFile[]>([]);
  const [commitState, setCommitState] = useState<CommitState>({
    status: "idle",
  });

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
          address: detection.detectedAddress ?? "",
          addressLocked: Boolean(detection.detectedAddress),
          rows: [],
          parseErrors: [],
          status: "detecting",
        };

        if (!detection.kind) {
          return {
            ...base,
            status: "error",
            errorMessage: "CSV の種別を判定できません",
          };
        }

        if (!base.address) {
          return { ...base, status: "needs-address" };
        }

        if (!ADDRESS_RE.test(base.address)) {
          return {
            ...base,
            status: "error",
            errorMessage: "アドレス形式が不正です",
          };
        }

        try {
          const result = await parseWithAddress(text, detection.kind, base.address);
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

  const handleChangeAddress = async (id: string, address: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, address, status: "detecting" } : f
      )
    );

    const current = files.find((f) => f.id === id);
    if (!current || !current.kind) return;

    if (!ADDRESS_RE.test(address)) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                address,
                status: address ? "error" : "needs-address",
                errorMessage: address ? "アドレス形式が不正です" : undefined,
                rows: [],
                parseErrors: [],
              }
            : f
        )
      );
      return;
    }

    try {
      const result = await parseWithAddress(
        current.rawText,
        current.kind,
        address
      );
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                address,
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
                address,
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
        { kind: CsvKind; address: string; rows: ParsedRow[] }
      >();
      for (const f of ready) {
        if (!f.kind) continue;
        const key = `${f.kind}::${f.address.toLowerCase()}`;
        const entry = groups.get(key) ?? {
          kind: f.kind,
          address: f.address,
          rows: [],
        };
        entry.rows.push(...f.rows);
        groups.set(key, entry);
      }

      const results: CommitGroupResult[] = [];
      for (const g of groups.values()) {
        const res = await commitGroup(g.address, g.kind, g.rows);
        results.push(res);
      }

      setCommitState({ status: "done", results });
      // Clear successfully committed files
      setFiles([]);
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
    <div>
      <h1 style={{ marginTop: 0 }}>Upload</h1>
      <p style={{ color: "#888" }}>
        Hyperliquid からエクスポートした CSV をアップロードして取り込みます。
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
                style={{ fontSize: "0.92rem", marginTop: 4 }}
              >
                <code>{r.address.slice(0, 10)}…</code> /{" "}
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
        <div style={{ marginTop: "1.5rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <h2 style={{ margin: 0 }}>ステージング中のファイル</h2>
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

          {files.map((f) => (
            <StagedFileCard
              key={f.id}
              file={f}
              onChangeAddress={handleChangeAddress}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
