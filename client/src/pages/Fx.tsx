import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { pb } from "../lib/pb";
import type { FxRecord } from "../lib/db-types";
import { COLORS, section } from "../styles";
import { SourceSelector } from "../components/fx/SourceSelector";
import {
  loadSourceFromStorage,
  persistSource,
  SOURCE_LABEL,
  type RateSource,
} from "../components/fx/source";
import { MizuhoSection } from "../components/fx/MizuhoSection";
import { FrankfurterSection } from "../components/fx/FrankfurterSection";
import { RateChart } from "../components/fx/RateChart";

/**
 * Page-level orchestrator.
 *
 * Responsibilities that don't fit any one sub-component:
 *   - guard: require at least 1 trade before showing anything
 *   - guard: require a `source` selection (Mizuho vs Frankfurter)
 *   - own the "common settings" (skipExisting)
 *   - own the rates loaded for the chart + the filter that drives it
 *   - hand sub-components a `reload` callback to refresh after writes
 *   - handle source switch (with full-data-wipe confirmation)
 *   - handle "delete all" button on the chart
 */
export function Fx() {
  // ── ガード state ──────────────────────────────────────
  const [tradeCount, setTradeCount] = useState<number | null>(null);
  const [source, setSource] = useState<RateSource | null>(() =>
    loadSourceFromStorage()
  );
  const [switching, setSwitching] = useState(false);

  // ── 共通設定 ──────────────────────────────────────────
  const [skipExisting, setSkipExisting] = useState(true);

  // ── 折れ線グラフ用 state ────────────────────────────────
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [rows, setRows] = useState<FxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 取引件数チェック (mount 1 回)
  useEffect(() => {
    (async () => {
      try {
        const res = await pb
          .collection("trades")
          .getList(1, 1, { fields: "id" });
        setTradeCount(res.totalItems);
      } catch {
        setTradeCount(0);
      }
    })();
  }, []);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const filterParts: string[] = [];
      if (filterFrom)
        filterParts.push(`date >= "${filterFrom} 00:00:00.000Z"`);
      if (filterTo) {
        const d = new Date(filterTo + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + 1);
        const endExclusive = d.toISOString().slice(0, 10);
        filterParts.push(`date < "${endExclusive} 00:00:00.000Z"`);
      }
      const filter = filterParts.join(" && ");
      const list = await pb
        .collection("fx_rates")
        .getFullList<FxRecord>({
          sort: "+date",
          filter: filter || undefined,
        });
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterFrom, filterTo]);

  /** Low-level: deletes every fx_rate row (no confirmation). */
  const deleteAllRates = async () => {
    const list = await pb
      .collection("fx_rates")
      .getFullList<{ id: string }>({ fields: "id" });
    const CHUNK = 20;
    for (let i = 0; i < list.length; i += CHUNK) {
      const chunk = list.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map((r) => pb.collection("fx_rates").delete(r.id))
      );
    }
    return list.length;
  };

  const handleDeleteAll = async () => {
    if (deleting) return;
    const list = await pb
      .collection("fx_rates")
      .getFullList<{ id: string }>({ fields: "id" });
    if (list.length === 0) {
      alert("削除するレートがありません");
      return;
    }
    if (
      !window.confirm(
        `本当に全 ${list.length.toLocaleString()} 件の FX レートを削除しますか？\n` +
          "元に戻せません (確定申告レポートが全件「未登録」になります)。"
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await deleteAllRates();
      await reload();
    } catch (e) {
      alert(
        "削除中にエラー: " + (e instanceof Error ? e.message : String(e))
      );
    } finally {
      setDeleting(false);
    }
  };

  // ── ソース選択 / 切替 ────────────────────────────────
  const changeSource = (s: RateSource | null) => {
    persistSource(s);
    setSource(s);
  };

  const handleSelectSource = async (newSource: RateSource) => {
    const existing = await pb
      .collection("fx_rates")
      .getFullList<{ id: string }>({ fields: "id" });
    if (existing.length > 0) {
      if (
        !window.confirm(
          `現在 ${existing.length.toLocaleString()} 件のレートが登録されています。\n` +
            `「${SOURCE_LABEL[newSource]}」を選択すると、既存のレートはすべて削除されます。\n\n` +
            "続行しますか？"
        )
      ) {
        return;
      }
      setSwitching(true);
      try {
        await deleteAllRates();
        await reload();
      } catch (e) {
        alert(
          "削除中にエラー: " + (e instanceof Error ? e.message : String(e))
        );
        setSwitching(false);
        return;
      }
      setSwitching(false);
    }
    changeSource(newSource);
  };

  const handleSwitchSource = async () => {
    if (!source) return;
    const newSource: RateSource =
      source === "mizuho" ? "frankfurter" : "mizuho";
    await handleSelectSource(newSource);
  };

  // ── ガード分岐 ───────────────────────────────────────
  if (tradeCount === null) return <p>読み込み中...</p>;

  if (tradeCount === 0) {
    return (
      <div>
        <h1 style={{ marginTop: 0 }}>為替レート (USD/JPY)</h1>
        <div
          style={{
            ...section,
            background: "#3b2f1d",
            border: "1px solid #6b522a",
            color: COLORS.warn,
          }}
        >
          <strong>⚠ 取引データがまだありません</strong>
          <p style={{ marginTop: 8, marginBottom: 0, color: "#e6c97a" }}>
            FX レート機能は確定申告レポート用の JPY 換算に使うため、
            先に取引データを登録してください。
          </p>
          <p style={{ marginTop: 12, marginBottom: 0 }}>
            <Link
              to="/settings/accounts"
              style={{
                display: "inline-block",
                background: COLORS.primary,
                color: "#fff",
                padding: "0.45rem 0.9rem",
                borderRadius: 6,
                textDecoration: "none",
                fontSize: "0.9rem",
              }}
            >
              アカウント設定へ
            </Link>
          </p>
        </div>
      </div>
    );
  }

  if (source === null) {
    return <SourceSelector onSelect={handleSelectSource} disabled={switching} />;
  }

  // ── 通常表示 ─────────────────────────────────────────
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <h1 style={{ marginTop: 0 }}>為替レート (USD/JPY)</h1>
        <div style={{ fontSize: "0.88rem", color: COLORS.muted }}>
          ソース:{" "}
          <strong style={{ color: COLORS.text }}>{SOURCE_LABEL[source]}</strong>
          <button
            type="button"
            onClick={handleSwitchSource}
            disabled={switching}
            style={{
              marginLeft: 10,
              background: "transparent",
              color: COLORS.link,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 6,
              padding: "0.25rem 0.6rem",
              cursor: switching ? "not-allowed" : "pointer",
              fontSize: "0.85rem",
            }}
            title={`${
              SOURCE_LABEL[source === "mizuho" ? "frankfurter" : "mizuho"]
            } に切替 (現在のレートは全削除)`}
          >
            {switching
              ? "切替中..."
              : `${
                  SOURCE_LABEL[source === "mizuho" ? "frankfurter" : "mizuho"]
                } に切替`}
          </button>
        </div>
      </div>
      <p style={{ color: COLORS.subtle, marginTop: 0 }}>
        確定申告レポートの JPY 換算に使う為替レートを登録します。
        該当日が無い場合は直近過去のレートが自動的に使われます (carry-forward)。
      </p>

      {/* 共通設定バナー */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: "1rem",
          padding: "0.7rem 1rem",
          background: COLORS.panelAlt,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            color: COLORS.subtle,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          共通設定
        </span>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: "0.9rem",
          }}
        >
          <input
            type="checkbox"
            checked={skipExisting}
            onChange={(e) => setSkipExisting(e.target.checked)}
          />
          既存レートを上書きしない
        </label>
        <span style={{ fontSize: "0.8rem", color: COLORS.faint }}>
          (取り込みに共通で適用)
        </span>
      </div>

      {source === "mizuho" && (
        <MizuhoSection skipExisting={skipExisting} onComplete={reload} />
      )}
      {source === "frankfurter" && (
        <FrankfurterSection skipExisting={skipExisting} onComplete={reload} />
      )}

      <RateChart
        rows={rows}
        loading={loading}
        error={error}
        filterFrom={filterFrom}
        filterTo={filterTo}
        onFilterFromChange={setFilterFrom}
        onFilterToChange={setFilterTo}
        onDeleteAll={handleDeleteAll}
        deleting={deleting}
      />
    </div>
  );
}
