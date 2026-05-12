import { useState } from "react";
import { Dropzone } from "../components/Dropzone";
import { StagedFileCard, type StagedFile } from "../components/StagedFileCard";
import {
  detectCsvKind,
  parseFundingCsv,
  parseTradeCsv,
  parseTransferCsv,
  type CsvKind,
} from "../lib/csv";

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

export function Upload() {
  const [files, setFiles] = useState<RawFile[]>([]);

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
              disabled={readyCount === 0}
              title={
                readyCount === 0
                  ? "解析済みファイルがありません"
                  : "DB 保存 (次のコミットで実装)"
              }
              style={{
                background: readyCount > 0 ? "#2563eb" : "#2a3047",
                color: readyCount > 0 ? "#fff" : "#666",
                border: "none",
                borderRadius: 6,
                padding: "0.5rem 1rem",
                cursor: readyCount > 0 ? "pointer" : "not-allowed",
              }}
            >
              DB に保存 ({readyCount} ファイル / {totalRows} 行)
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
