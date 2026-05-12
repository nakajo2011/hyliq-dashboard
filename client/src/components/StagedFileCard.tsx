import type { CsvKind, ParsedRow } from "../lib/csv";

export type StagedFile = {
  id: string;
  filename: string;
  size: number;
  kind: CsvKind | null;
  detectionReason: string;
  accountName: string;
  rows: ParsedRow[];
  parseErrors: { line: number; message: string }[];
  status: "detecting" | "needs-account" | "ready" | "error";
  errorMessage?: string;
};

const KIND_LABEL: Record<CsvKind, string> = {
  trade: "取引履歴 (trade)",
  funding: "ファンディング (funding)",
  transfer: "入出金 (transfer)",
};

interface Props {
  file: StagedFile;
  /** Names of accounts already in the DB, suggested in the combobox. */
  existingNames: string[];
  /** datalist id to wire the combobox up to the shared options list. */
  datalistId: string;
  onChangeAccountName: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}

export function StagedFileCard({
  file,
  existingNames,
  datalistId,
  onChangeAccountName,
  onRemove,
}: Props) {
  const isExisting = existingNames.includes(file.accountName.trim());
  return (
    <div
      style={{
        border: "1px solid #2a3047",
        borderRadius: 8,
        padding: "1rem",
        marginTop: "0.8rem",
        background: "#141823",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {file.filename}
          </div>
          <div style={{ color: "#888", fontSize: "0.85rem", marginTop: 2 }}>
            {file.kind ? KIND_LABEL[file.kind] : "種別不明"} ・{" "}
            {(file.size / 1024).toFixed(1)} KB ・ {file.detectionReason}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onRemove(file.id)}
          style={{
            background: "transparent",
            border: "1px solid #444",
            color: "#bbb",
            borderRadius: 6,
            padding: "0.3rem 0.6rem",
            cursor: "pointer",
          }}
        >
          削除
        </button>
      </div>

      <div style={{ marginTop: "0.8rem" }}>
        <label style={{ fontSize: "0.85rem", color: "#aab" }}>
          アカウント名{" "}
          {file.accountName.trim() && (
            <span
              style={{
                color: isExisting ? "#5dd58c" : "#f5b942",
                fontSize: "0.78rem",
              }}
            >
              ({isExisting ? "既存アカウント" : "新規アカウント"})
            </span>
          )}
        </label>
        <input
          type="text"
          list={datalistId}
          value={file.accountName}
          onChange={(e) => onChangeAccountName(file.id, e.target.value)}
          placeholder="既存アカウントを選択、または新しいアカウント名を入力"
          style={{
            display: "block",
            width: "100%",
            marginTop: 4,
            padding: "0.45rem 0.6rem",
            background: "#0f1218",
            color: "#e6e6e6",
            border: "1px solid #2a3047",
            borderRadius: 6,
          }}
        />
      </div>

      <div style={{ marginTop: "0.8rem", fontSize: "0.9rem" }}>
        {file.status === "detecting" && <span>解析中...</span>}
        {file.status === "needs-account" && (
          <span style={{ color: "#f5b942" }}>
            アカウント名を入力してください
          </span>
        )}
        {file.status === "error" && (
          <span style={{ color: "#ff6b6b" }}>
            ❌ {file.errorMessage ?? "解析エラー"}
          </span>
        )}
        {file.status === "ready" && (
          <span style={{ color: "#5dd58c" }}>
            ✅ {file.rows.length} 行を解析
            {file.parseErrors.length > 0 &&
              ` (うち ${file.parseErrors.length} 行はスキップ)`}
          </span>
        )}
      </div>

      {file.rows.length > 0 && file.status === "ready" && (
        <details style={{ marginTop: "0.8rem" }}>
          <summary
            style={{ cursor: "pointer", color: "#aab", fontSize: "0.85rem" }}
          >
            プレビュー (先頭 5 行)
          </summary>
          <pre
            style={{
              marginTop: "0.5rem",
              padding: "0.6rem",
              background: "#0a0d13",
              borderRadius: 6,
              fontSize: "0.75rem",
              overflowX: "auto",
            }}
          >
            {JSON.stringify(file.rows.slice(0, 5), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
