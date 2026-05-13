import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FxRecord } from "../../lib/db-types";
import { dateOnly } from "../../lib/format";
import {
  btnDanger,
  btnDangerDisabled,
  btnGhost,
  chartLabel,
  chartTooltip,
  COLORS,
  h2,
  input,
  lbl,
  section,
} from "../../styles";

interface Props {
  rows: FxRecord[];
  loading: boolean;
  error: string | null;
  filterFrom: string;
  filterTo: string;
  onFilterFromChange: (v: string) => void;
  onFilterToChange: (v: string) => void;
  onDeleteAll: () => void;
  deleting: boolean;
}

/** Line chart of registered rates over time + date range filter + delete-all. */
export function RateChart({
  rows,
  loading,
  error,
  filterFrom,
  filterTo,
  onFilterFromChange,
  onFilterToChange,
  onDeleteAll,
  deleting,
}: Props) {
  const chartData = useMemo(
    () =>
      rows.map((r) => ({ date: dateOnly(r.date), usd_jpy: r.usd_jpy })),
    [rows]
  );

  const stats = useMemo(() => {
    if (rows.length === 0) return null;
    const values = rows.map((r) => r.usd_jpy);
    return {
      count: rows.length,
      min: Math.min(...values),
      max: Math.max(...values),
      first: rows[0],
      last: rows[rows.length - 1],
    };
  }, [rows]);

  return (
    <section style={section}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ ...h2, marginBottom: 0 }}>
          登録済みレートの推移{" "}
          {stats && (
            <span
              style={{
                color: COLORS.faint,
                fontWeight: 400,
                fontSize: "0.85rem",
              }}
            >
              ({stats.count.toLocaleString()} 件、
              {dateOnly(stats.first.date)} 〜 {dateOnly(stats.last.date)})
            </span>
          )}
        </h2>
        {stats && stats.count > 0 && (
          <button
            type="button"
            onClick={onDeleteAll}
            disabled={deleting}
            style={deleting ? btnDangerDisabled : btnDanger}
            title="登録されている FX レートをすべて削除"
          >
            {deleting ? "削除中..." : "🗑 全削除"}
          </button>
        )}
      </div>

      {/* 期間フィルタ */}
      <div
        style={{
          display: "flex",
          gap: "0.6rem",
          alignItems: "flex-end",
          flexWrap: "wrap",
          marginBottom: "0.8rem",
          marginTop: "0.8rem",
        }}
      >
        <div>
          <label style={lbl}>From</label>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => onFilterFromChange(e.target.value)}
            style={input}
          />
        </div>
        <div>
          <label style={lbl}>To</label>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => onFilterToChange(e.target.value)}
            style={input}
          />
        </div>
        {(filterFrom || filterTo) && (
          <button
            type="button"
            onClick={() => {
              onFilterFromChange("");
              onFilterToChange("");
            }}
            style={btnGhost}
          >
            フィルタクリア
          </button>
        )}
      </div>

      {loading && <p>読み込み中...</p>}
      {error && <p style={{ color: COLORS.neg }}>❌ {error}</p>}

      {!loading && !error && rows.length === 0 && (
        <p style={{ color: COLORS.subtle }}>
          {filterFrom || filterTo
            ? "この期間にレートはありません"
            : "まだレートがありません。上のセクションから取り込んでください。"}
        </p>
      )}

      {!loading && rows.length > 0 && stats && (
        <>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                stroke={COLORS.subtle}
                fontSize={12}
                minTickGap={40}
              />
              <YAxis
                stroke={COLORS.subtle}
                fontSize={12}
                domain={["auto", "auto"]}
                tickFormatter={(v) =>
                  typeof v === "number" ? v.toFixed(1) : String(v)
                }
              />
              <Tooltip
                contentStyle={chartTooltip}
                labelStyle={chartLabel}
                formatter={(v) =>
                  typeof v === "number" ? v.toFixed(3) : String(v)
                }
              />
              <Line
                type="monotone"
                dataKey="usd_jpy"
                stroke={COLORS.link}
                dot={false}
                strokeWidth={1.5}
              />
            </LineChart>
          </ResponsiveContainer>

          <div
            style={{
              display: "flex",
              gap: "1.5rem",
              marginTop: "0.6rem",
              fontSize: "0.85rem",
              color: COLORS.muted,
              flexWrap: "wrap",
            }}
          >
            <span>
              最新:{" "}
              <strong style={{ color: COLORS.text }}>
                {dateOnly(stats.last.date)} = {stats.last.usd_jpy.toFixed(3)}
              </strong>
            </span>
            <span>
              Min:{" "}
              <strong style={{ color: COLORS.muted }}>
                {stats.min.toFixed(3)}
              </strong>
            </span>
            <span>
              Max:{" "}
              <strong style={{ color: COLORS.muted }}>
                {stats.max.toFixed(3)}
              </strong>
            </span>
          </div>
        </>
      )}
    </section>
  );
}
