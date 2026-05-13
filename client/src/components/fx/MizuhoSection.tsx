import { useRef, useState } from "react";
import { pb } from "../../lib/pb";
import {
  parseMizuhoCsv,
  upsertFxRate,
  type MizuhoParseResult,
} from "../../lib/fx";
import { dateKeyJst } from "../../lib/pnl";
import { dateOnly } from "../../lib/format";
import { btnDisabled, btnPrimary, COLORS, h2, section } from "../../styles";

interface Props {
  /** Mirrors the parent's common-settings "skip existing" toggle. */
  skipExisting: boolean;
  /** Called after a successful save so the parent can refresh derived UIs. */
  onComplete: () => Promise<void>;
}

type FilterInfo = {
  totalParsed: number;
  droppedBeforeTrades: number;
  earliestTradeDate: string | null;
};

type SaveStatus =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; saved: number; skipped: number }
  | { status: "error"; message: string };

/** Drag&drop area + parse + filter-by-trade-range + upsert. */
export function MizuhoSection({ skipExisting, onComplete }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<MizuhoParseResult | null>(null);
  const [filterInfo, setFilterInfo] = useState<FilterInfo | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ status: "idle" });
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    setFile(f);
    setParsed(null);
    setFilterInfo(null);
    setStatus({ status: "idle" });
    try {
      // Earliest trade date (JST) — used to skip pre-trade rows.
      let earliest: string | null = null;
      try {
        const first = await pb
          .collection("trades")
          .getList<{ time: string }>(1, 1, {
            sort: "+time",
            fields: "time",
          });
        if (first.items.length > 0) {
          earliest = dateKeyJst(first.items[0].time);
        }
      } catch {
        // ignore — proceed without filtering
      }

      const buf = await f.arrayBuffer();
      const result = parseMizuhoCsv(buf);

      let rates = result.rates;
      let dropped = 0;
      if (earliest) {
        const before = rates.length;
        rates = rates.filter((r) => r.date >= earliest);
        dropped = before - rates.length;
      }

      setParsed({
        rates,
        errors: result.errors,
        range:
          rates.length > 0
            ? { start: rates[0].date, end: rates[rates.length - 1].date }
            : undefined,
      });
      setFilterInfo({
        totalParsed: result.rates.length,
        droppedBeforeTrades: dropped,
        earliestTradeDate: earliest,
      });
      if (rates.length === 0 && result.errors.length > 0) {
        setStatus({ status: "error", message: result.errors[0] });
      }
    } catch (e) {
      setStatus({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleSave = async () => {
    if (!parsed || parsed.rates.length === 0) return;
    setStatus({ status: "running" });

    let existing = new Set<string>();
    if (skipExisting) {
      try {
        const list = await pb
          .collection("fx_rates")
          .getFullList<{ date: string }>({ fields: "date" });
        existing = new Set(list.map((r) => dateOnly(r.date)));
      } catch {
        // proceed without skip set
      }
    }

    let saved = 0;
    let skipped = 0;
    try {
      for (const r of parsed.rates) {
        if (existing.has(r.date)) {
          skipped++;
        } else {
          await upsertFxRate(r.date, r.usd_jpy);
          saved++;
        }
      }
      setStatus({ status: "done", saved, skipped });
      setFile(null);
      setParsed(null);
      setFilterInfo(null);
      await onComplete();
    } catch (e) {
      setStatus({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <section
      style={{
        ...section,
        border: "1px solid #2d5a3d",
        background: "#15281c",
      }}
    >
      <h2 style={h2}>
        みずほ CSV から TTM を取り込む{" "}
        <span style={{ color: COLORS.pos, fontSize: "0.8rem" }}>
          (確定申告で推奨)
        </span>
      </h2>
      <p style={{ color: COLORS.muted, fontSize: "0.85rem", marginTop: 0 }}>
        みずほ銀行が公開している <code>quote.csv</code> には 2002 年以降の
        日次 TTM (公示仲値) が 1 ファイルにまとまっています。国税庁が認める
        銀行公示レートで、確定申告で最も使われる標準値です。
        ブラウザでダウンロードしてから下にアップロードしてください
        (スクレイプは行いません)。
      </p>

      <ol
        style={{ paddingLeft: "1.2rem", margin: "0.8rem 0", lineHeight: 1.7 }}
      >
        <li>
          <a
            href="https://www.mizuhobank.co.jp/market/quote.csv"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block",
              marginTop: 4,
              background: COLORS.primary,
              color: "#fff",
              padding: "0.4rem 0.9rem",
              borderRadius: 6,
              textDecoration: "none",
              fontSize: "0.9rem",
            }}
          >
            📥 quote.csv をダウンロード (新タブ)
          </a>{" "}
          <span style={{ color: COLORS.subtle, fontSize: "0.8rem" }}>
            約 1.1MB、Shift_JIS、全期間 (2002〜現在)
          </span>
        </li>
        <li>
          ダウンロードしたファイルを下の枠にドラッグ&ドロップ、
          またはクリックして選択:
          <div
            onDragEnter={(ev) => {
              ev.preventDefault();
              setDrag(true);
            }}
            onDragOver={(ev) => {
              ev.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(ev) => {
              ev.preventDefault();
              setDrag(false);
              const f = ev.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
            onClick={() => inputRef.current?.click()}
            style={{
              marginTop: 8,
              border: `2px dashed ${drag ? COLORS.link : "#3a5a4d"}`,
              background: drag ? "#1a2030" : "#0f1a14",
              borderRadius: 8,
              padding: "1.2rem",
              textAlign: "center",
              cursor: "pointer",
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              style={{ display: "none" }}
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                if (f) handleFile(f);
                ev.target.value = "";
              }}
            />
            {file ? (
              <div>
                <strong>{file.name}</strong>{" "}
                <span style={{ color: COLORS.subtle }}>
                  ({(file.size / 1024).toFixed(0)} KB)
                </span>
              </div>
            ) : (
              <span style={{ color: COLORS.muted }}>
                ここに quote.csv をドロップ
              </span>
            )}
          </div>
        </li>
        {parsed && parsed.rates.length > 0 && (
          <li>
            <strong>{parsed.rates.length.toLocaleString()} 件</strong>{" "}
            のレートを保存対象に抽出
            {parsed.range && (
              <>
                {" "}
                ({parsed.range.start} 〜 {parsed.range.end})
              </>
            )}
            {filterInfo &&
              filterInfo.droppedBeforeTrades > 0 &&
              filterInfo.earliestTradeDate && (
                <div
                  style={{
                    fontSize: "0.82rem",
                    color: COLORS.muted,
                    marginTop: 2,
                  }}
                >
                  元データ {filterInfo.totalParsed.toLocaleString()} 件 →
                  取引最古日 ({filterInfo.earliestTradeDate}) 以降のみ採用、
                  {filterInfo.droppedBeforeTrades.toLocaleString()} 件を
                  除外してストレージを節約
                </div>
              )}
            {filterInfo && !filterInfo.earliestTradeDate && (
              <div
                style={{
                  fontSize: "0.82rem",
                  color: COLORS.warn,
                  marginTop: 2,
                }}
              >
                ⚠ 取引データがまだ無いため全期間をインポートします。
                Upload 後に再取り込みすると不要分が除外されます。
              </div>
            )}
            {parsed.errors.length > 0 && (
              <span style={{ color: COLORS.warn, marginLeft: 6 }}>
                (警告 {parsed.errors.length} 件)
              </span>
            )}
            <div style={{ marginTop: 6 }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={status.status === "running"}
                style={status.status === "running" ? btnDisabled : btnPrimary}
              >
                {status.status === "running" ? "保存中..." : "保存"}
              </button>
              <span
                style={{
                  marginLeft: 12,
                  fontSize: "0.85rem",
                  color: COLORS.muted,
                }}
              >
                ↑ ページ上部の「共通設定」が適用されます
              </span>
            </div>
          </li>
        )}
      </ol>

      {status.status === "done" && (
        <p style={{ color: COLORS.pos, marginTop: 8, fontSize: "0.9rem" }}>
          ✅ 新規 {status.saved} 件、スキップ {status.skipped} 件
        </p>
      )}
      {status.status === "error" && (
        <p style={{ color: COLORS.neg, marginTop: 8, fontSize: "0.9rem" }}>
          ❌ {status.message}
        </p>
      )}
    </section>
  );
}
