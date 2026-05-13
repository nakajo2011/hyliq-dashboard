import { useState } from "react";
import { pb } from "../../lib/pb";
import { fetchFrankfurterRange, upsertFxRate } from "../../lib/fx";
import { dateKeyJst } from "../../lib/pnl";
import { dateOnly } from "../../lib/format";
import {
  btnDisabled,
  btnPrimary,
  COLORS,
  h2,
  input,
  lbl,
  section,
} from "../../styles";

interface Props {
  skipExisting: boolean;
  onComplete: () => Promise<void>;
}

type ApiStatus =
  | { status: "idle" }
  | { status: "running" }
  | {
      status: "done";
      range: string;
      fetched: number;
      saved: number;
      skipped: number;
    }
  | { status: "error"; message: string };

/** Frankfurter (ECB) auto-fetch section: trade-range button + explicit range. */
export function FrankfurterSection({ skipExisting, onComplete }: Props) {
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [apiStatus, setApiStatus] = useState<ApiStatus>({ status: "idle" });

  const fetchAndStore = async (from: string, to: string) => {
    setApiStatus({ status: "running" });
    try {
      const result = await fetchFrankfurterRange(from, to);

      let existing = new Set<string>();
      if (skipExisting) {
        const list = await pb
          .collection("fx_rates")
          .getFullList<{ date: string }>({ fields: "date" });
        existing = new Set(list.map((r) => dateOnly(r.date)));
      }

      let saved = 0;
      let skipped = 0;
      for (const r of result.rates) {
        if (existing.has(r.date)) {
          skipped++;
        } else {
          await upsertFxRate(r.date, r.usd_jpy);
          saved++;
        }
      }

      setApiStatus({
        status: "done",
        range: `${result.startDate} 〜 ${result.endDate}`,
        fetched: result.rates.length,
        saved,
        skipped,
      });
      await onComplete();
    } catch (e) {
      setApiStatus({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleFetchTradeRange = async () => {
    try {
      const trades = await pb
        .collection("trades")
        .getFullList<{ time: string }>({ fields: "time", sort: "+time" });
      if (trades.length === 0) {
        alert("取引データがありません。Upload からインポートしてください。");
        return;
      }
      const earliest = dateKeyJst(trades[0].time);
      const latest = dateKeyJst(trades[trades.length - 1].time);
      await fetchAndStore(earliest, latest);
    } catch (e) {
      setApiStatus({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleFetchManualRange = async () => {
    if (!rangeFrom || !rangeTo) {
      alert("期間を指定してください");
      return;
    }
    await fetchAndStore(rangeFrom, rangeTo);
  };

  const running = apiStatus.status === "running";

  return (
    <section style={section}>
      <h2 style={h2}>API から取得 (Frankfurter / ECB)</h2>
      <p style={{ color: COLORS.subtle, fontSize: "0.85rem", marginTop: 0 }}>
        Frankfurter API (ECB の日次レート、無料・API キー不要) から
        USD/JPY を一括取得します。週末・祝日は欠落しますが、
        carry-forward で吸収されます。MUFG TTM とは数値が微妙に異なる
        (通常 0.1〜0.5 円差) ため、より厳密にしたい場合はソースを みずほ TTM に
        切替えてください。
      </p>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: "0.8rem",
        }}
      >
        <button
          type="button"
          onClick={handleFetchTradeRange}
          disabled={running}
          style={running ? btnDisabled : btnPrimary}
        >
          {running ? "取得中..." : "取引日の全範囲を取得"}
        </button>
        <span style={{ color: COLORS.faint, fontSize: "0.85rem" }}>
          ← 取引データの最古日〜最新日まで一括取得
        </span>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div>
          <label style={lbl}>From</label>
          <input
            type="date"
            value={rangeFrom}
            onChange={(e) => setRangeFrom(e.target.value)}
            style={input}
          />
        </div>
        <div>
          <label style={lbl}>To</label>
          <input
            type="date"
            value={rangeTo}
            onChange={(e) => setRangeTo(e.target.value)}
            style={input}
          />
        </div>
        <button
          type="button"
          onClick={handleFetchManualRange}
          disabled={running || !rangeFrom || !rangeTo}
          style={running || !rangeFrom || !rangeTo ? btnDisabled : btnPrimary}
        >
          期間を取得
        </button>
      </div>

      {apiStatus.status === "done" && (
        <p style={{ color: COLORS.pos, marginTop: "0.8rem", fontSize: "0.9rem" }}>
          ✅ {apiStatus.range}: API から {apiStatus.fetched} 件取得 → 新規{" "}
          {apiStatus.saved} 件、スキップ {apiStatus.skipped} 件
        </p>
      )}
      {apiStatus.status === "error" && (
        <p style={{ color: COLORS.neg, marginTop: "0.8rem", fontSize: "0.9rem" }}>
          ❌ {apiStatus.message}
        </p>
      )}
    </section>
  );
}
