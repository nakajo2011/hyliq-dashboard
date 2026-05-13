import { COLORS } from "../../styles";
import type { RateSource } from "./source";

interface Props {
  onSelect: (source: RateSource) => void;
  disabled?: boolean;
}

export function SourceSelector({ onSelect, disabled }: Props) {
  return (
    <div>
      <h1 style={{ marginTop: 0 }}>FX レート (USD/JPY)</h1>
      <p style={{ color: COLORS.subtle }}>
        確定申告で使う USD/JPY のレートソースを選んでください。
        いつでも切り替え可能ですが、切り替え時は登録済みレートがすべて削除されます。
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1rem",
          marginTop: "1.2rem",
        }}
      >
        <button
          type="button"
          onClick={() => onSelect("mizuho")}
          disabled={disabled}
          style={{
            padding: "1.2rem",
            background: "#15281c",
            border: "1px solid #2d5a3d",
            borderRadius: 8,
            color: COLORS.text,
            cursor: disabled ? "not-allowed" : "pointer",
            textAlign: "left",
            fontFamily: "inherit",
          }}
        >
          <div style={{ fontWeight: 600, color: COLORS.pos, marginBottom: 6 }}>
            みずほ TTM (確定申告で推奨)
          </div>
          <div style={{ fontSize: "0.85rem", color: COLORS.muted }}>
            三菱UFJ銀行 公示仲値と同等の標準レート。みずほ銀行が公開する
            quote.csv を手動ダウンロード → アップロードで取り込み。
            国税庁が認める銀行公示レート。
          </div>
        </button>
        <button
          type="button"
          onClick={() => onSelect("frankfurter")}
          disabled={disabled}
          style={{
            padding: "1.2rem",
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            color: COLORS.text,
            cursor: disabled ? "not-allowed" : "pointer",
            textAlign: "left",
            fontFamily: "inherit",
          }}
        >
          <div style={{ fontWeight: 600, color: COLORS.link, marginBottom: 6 }}>
            Frankfurter (ECB)
          </div>
          <div style={{ fontSize: "0.85rem", color: COLORS.muted }}>
            ECB が公開する日次レートを API で自動取得。無料・API キー不要。
            TTM とは 0.1〜0.5 円差。手早く済ませたい場合に。
          </div>
        </button>
      </div>
    </div>
  );
}
