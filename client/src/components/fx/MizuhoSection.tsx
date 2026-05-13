import { useMemo, useRef, useState } from "react";
import { pb } from "../../lib/pb";
import {
  parseMizuhoCsv,
  upsertFxRate,
  type MizuhoParseResult,
} from "../../lib/fx";
import { dateKeyJst } from "../../lib/pnl";
import { dateOnly } from "../../lib/format";
import {
  btnDisabled,
  btnGhost,
  btnPrimary,
  COLORS,
  h2,
  input,
  lbl,
  section,
} from "../../styles";

interface Props {
  /** Mirrors the parent's common-settings "skip existing" toggle. */
  skipExisting: boolean;
  /** Called after a successful save so the parent can refresh derived UIs. */
  onComplete: () => Promise<void>;
}

interface ParsedInfo {
  /** All rates parsed from the CSV, full range. */
  parsed: MizuhoParseResult;
  /** Default From inferred from the earliest date across trades/fundings/transfers. */
  defaultFrom: string;
  /** Default To = parsed.range.end. */
  defaultTo: string;
}

type SaveStatus =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; saved: number; skipped: number }
  | { status: "error"; message: string };

/**
 * Drag&drop upload of Mizuho quote.csv. After parsing, the user reviews the
 * import range (defaults to "earliest date across all 3 record sets → CSV
 * latest date") and confirms. Rates outside the range are skipped to save
 * DB space.
 */
export function MizuhoSection({ skipExisting, onComplete }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<ParsedInfo | null>(null);
  const [importFrom, setImportFrom] = useState("");
  const [importTo, setImportTo] = useState("");
  const [status, setStatus] = useState<SaveStatus>({ status: "idle" });
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Look up the earliest existing record date across trades/fundings/transfers. */
  const fetchEarliestRecordDate = async (): Promise<string | null> => {
    const fetchEarliest = async (collection: string) => {
      try {
        const res = await pb
          .collection(collection)
          .getList<{ time: string }>(1, 1, {
            sort: "+time",
            fields: "time",
          });
        if (res.items.length > 0) return dateKeyJst(res.items[0].time);
      } catch {
        // ignore
      }
      return null;
    };

    const candidates = await Promise.all([
      fetchEarliest("trades"),
      fetchEarliest("fundings"),
      fetchEarliest("transfers"),
    ]);
    const valid = candidates.filter((d): d is string => d !== null);
    if (valid.length === 0) return null;
    return valid.reduce((min, d) => (d < min ? d : min));
  };

  const handleFile = async (f: File) => {
    setFile(f);
    setInfo(null);
    setImportFrom("");
    setImportTo("");
    setStatus({ status: "idle" });

    try {
      const [earliestRecord, buf] = await Promise.all([
        fetchEarliestRecordDate(),
        f.arrayBuffer(),
      ]);
      const parsed = parseMizuhoCsv(buf);

      if (parsed.rates.length === 0) {
        if (parsed.errors.length > 0) {
          setStatus({ status: "error", message: parsed.errors[0] });
        }
        return;
      }

      const csvStart = parsed.range!.start;
      const csvEnd = parsed.range!.end;
      const defaultFrom = earliestRecord ?? csvStart;
      // Clamp so default doesn't fall outside the CSV's actual range.
      const clampedFrom = defaultFrom < csvStart ? csvStart : defaultFrom;
      const defaultTo = csvEnd;

      setInfo({ parsed, defaultFrom: clampedFrom, defaultTo });
      setImportFrom(clampedFrom);
      setImportTo(defaultTo);
    } catch (e) {
      setStatus({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const filteredRates = useMemo(() => {
    if (!info) return [];
    return info.parsed.rates.filter((r) => {
      if (importFrom && r.date < importFrom) return false;
      if (importTo && r.date > importTo) return false;
      return true;
    });
  }, [info, importFrom, importTo]);

  const handleResetRange = () => {
    if (!info) return;
    setImportFrom(info.defaultFrom);
    setImportTo(info.defaultTo);
  };

  const handleSave = async () => {
    if (filteredRates.length === 0) {
      alert("取り込み期間内にレートがありません");
      return;
    }
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
      for (const r of filteredRates) {
        if (existing.has(r.date)) {
          skipped++;
        } else {
          await upsertFxRate(r.date, r.usd_jpy);
          saved++;
        }
      }
      setStatus({ status: "done", saved, skipped });
      setFile(null);
      setInfo(null);
      setImportFrom("");
      setImportTo("");
      await onComplete();
    } catch (e) {
      setStatus({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const rangeChanged =
    info != null &&
    (importFrom !== info.defaultFrom || importTo !== info.defaultTo);
  const droppedByRange = info
    ? info.parsed.rates.length - filteredRates.length
    : 0;

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
        {info && (
          <li>
            CSV 全体: <strong>{info.parsed.rates.length.toLocaleString()}</strong>{" "}
            件 ({info.parsed.range!.start} 〜 {info.parsed.range!.end})
            {info.parsed.errors.length > 0 && (
              <span style={{ color: COLORS.warn, marginLeft: 6 }}>
                (警告 {info.parsed.errors.length} 件)
              </span>
            )}
            <div
              style={{
                fontSize: "0.82rem",
                color: COLORS.muted,
                marginTop: 2,
              }}
            >
              既定の取り込み期間は{" "}
              <strong style={{ color: COLORS.text }}>
                {info.defaultFrom}
              </strong>{" "}
              〜{" "}
              <strong style={{ color: COLORS.text }}>{info.defaultTo}</strong>
              {" "}
              (取引/Funding/入出金 の最古日 → quote.csv の最終日)。
              下で調整できます。
            </div>
          </li>
        )}
        {info && (
          <li>
            取り込み期間:
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-end",
                marginTop: 6,
                flexWrap: "wrap",
              }}
            >
              <div>
                <label style={lbl}>From</label>
                <input
                  type="date"
                  value={importFrom}
                  onChange={(e) => setImportFrom(e.target.value)}
                  style={input}
                />
              </div>
              <div>
                <label style={lbl}>To</label>
                <input
                  type="date"
                  value={importTo}
                  onChange={(e) => setImportTo(e.target.value)}
                  style={input}
                />
              </div>
              {rangeChanged && (
                <button
                  type="button"
                  onClick={handleResetRange}
                  style={btnGhost}
                >
                  既定値に戻す
                </button>
              )}
            </div>
            <div
              style={{
                fontSize: "0.85rem",
                color: COLORS.muted,
                marginTop: 8,
              }}
            >
              <strong style={{ color: COLORS.text }}>
                {filteredRates.length.toLocaleString()} 件
              </strong>{" "}
              を保存対象、
              {droppedByRange.toLocaleString()} 件を期間外として除外
            </div>
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={
                  status.status === "running" || filteredRates.length === 0
                }
                style={
                  status.status === "running" || filteredRates.length === 0
                    ? btnDisabled
                    : btnPrimary
                }
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
