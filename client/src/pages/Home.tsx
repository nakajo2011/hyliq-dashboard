import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { pb, PB_URL } from "../lib/pb";
import {
  buildAccountStats,
  buildCoinPnL,
  buildDailyPnL,
  convertTradesToJpy,
} from "../lib/pnl";
import type {
  FundingLike,
  TradeLike,
  TransferLike,
} from "../lib/pnl";
import type { FxRate } from "../lib/fx";
import { fmtJpy, fmtUsd } from "../lib/format";
import { h2 as sectionTitle, td, tdRight, th } from "../styles";

interface AccountRow {
  id: string;
  name: string;
  address: string;
}
type TradeRow = TradeLike & { id: string; account: string };
type FundingRow = FundingLike & { id: string; account: string };
type TransferRow = TransferLike & { id: string; account: string };
type FxRecord = FxRate & { id: string };

type Currency = "USD" | "JPY";

type State =
  | { status: "loading" }
  | { status: "no-data"; healthOk: boolean }
  | {
      status: "ready";
      accounts: AccountRow[];
      trades: TradeRow[];
      fundings: FundingRow[];
      transfers: TransferRow[];
      fxRates: FxRate[];
    }
  | { status: "error"; message: string };

export function Home() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await pb.health.check();
      } catch (err) {
        if (!cancelled)
          setState({
            status: "error",
            message: `PocketBase に接続できません (${PB_URL}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
        return;
      }

      try {
        const accounts = await pb
          .collection("accounts")
          .getFullList<AccountRow>({ sort: "name" });
        if (accounts.length === 0) {
          if (!cancelled) setState({ status: "no-data", healthOk: true });
          return;
        }
        const [trades, fundings, transfers, fxRows] = await Promise.all([
          pb.collection("trades").getFullList<TradeRow>({ sort: "+time" }),
          pb.collection("fundings").getFullList<FundingRow>({ sort: "+time" }),
          pb
            .collection("transfers")
            .getFullList<TransferRow>({ sort: "+time" }),
          pb.collection("fx_rates").getFullList<FxRecord>(),
        ]);
        if (cancelled) return;
        const fxRates: FxRate[] = fxRows.map((r) => ({
          date: r.date.slice(0, 10),
          usd_jpy: r.usd_jpy,
        }));
        setState({
          status: "ready",
          accounts,
          trades,
          fundings,
          transfers,
          fxRates,
        });
      } catch (e) {
        if (cancelled) return;
        setState({
          status: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <p>読み込み中...</p>;
  if (state.status === "error")
    return <p style={{ color: "#ff6b6b" }}>❌ {state.message}</p>;
  if (state.status === "no-data") return <EmptyState />;

  return <Dashboard state={state} />;
}

function EmptyState() {
  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Hyliq Dashboard</h1>
      <p style={{ color: "#aab" }}>
        Hyperliquid Perp 取引損益ダッシュボードへようこそ。
      </p>
      <div
        style={{
          marginTop: "1.5rem",
          padding: "1.5rem",
          background: "#141823",
          border: "1px solid #2a3047",
          borderRadius: 8,
        }}
      >
        <h2 style={{ marginTop: 0 }}>はじめかた</h2>
        <ol style={{ lineHeight: 1.8 }}>
          <li>
            Hyperliquid の Web 管理画面から CSV をエクスポート
            (trade_history / funding_history / deposits_and_withdrawals)
          </li>
          <li>
            <Link to="/upload" style={{ color: "#6cf" }}>
              Upload
            </Link>{" "}
            ページから CSV をドラッグ&ドロップ
          </li>
          <li>取り込まれたデータが Home と Accounts に表示されます</li>
        </ol>
      </div>
    </div>
  );
}

/**
 * Replace closed_pnl with pnl_jpy for trades that have a resolvable rate.
 * Trades without a rate are dropped so they don't skew the dashboard.
 */
function jpyConvertedTrades<T extends TradeRow>(
  trades: T[],
  fxRates: FxRate[]
): { trades: T[]; missing: number } {
  const result = convertTradesToJpy(trades, fxRates);
  const kept: T[] = [];
  for (let i = 0; i < result.trades.length; i++) {
    const c = result.trades[i];
    if (c.pnl_jpy != null) {
      kept.push({ ...trades[i], closed_pnl: c.pnl_jpy });
    }
  }
  return { trades: kept, missing: result.missingCount };
}

function Dashboard({
  state,
}: {
  state: Extract<State, { status: "ready" }>;
}) {
  const { accounts, trades, fundings, transfers, fxRates } = state;

  const [currency, setCurrency] = useState<Currency>("USD");

  // Convert (or pass through) the trades based on the selected currency.
  const { displayedTrades, missingCount } = useMemo(() => {
    if (currency === "USD") {
      return { displayedTrades: trades, missingCount: 0 };
    }
    const { trades: kept, missing } = jpyConvertedTrades(trades, fxRates);
    return { displayedTrades: kept, missingCount: missing };
  }, [currency, trades, fxRates]);

  const stats = useMemo(
    () => buildAccountStats(displayedTrades, fundings, transfers),
    [displayedTrades, fundings, transfers]
  );
  const daily = useMemo(() => buildDailyPnL(displayedTrades), [displayedTrades]);
  const coinPnL = useMemo(() => buildCoinPnL(displayedTrades), [displayedTrades]);

  const fmt = currency === "JPY" ? fmtJpy : fmtUsd;
  const currencyLabel = currency === "JPY" ? "JPY" : "USD";

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <h1 style={{ marginTop: 0, marginBottom: 4 }}>Home</h1>
          <p style={{ color: "#888", margin: 0 }}>
            {accounts.length} アカウントの合算サマリ。{" "}
            <Link to="/accounts" style={{ color: "#6cf" }}>
              各アカウント詳細へ
            </Link>
          </p>
        </div>
        <CurrencyToggle currency={currency} onChange={setCurrency} />
      </div>

      {currency === "JPY" && missingCount > 0 && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.6rem 0.9rem",
            background: "#3b2f1d",
            border: "1px solid #6b522a",
            borderRadius: 6,
            color: "#f5d678",
            fontSize: "0.88rem",
          }}
        >
          ⚠️ FX レート未登録の取引が {missingCount} 件あるため集計から除外しています。
          <Link to="/fx" style={{ color: "#6cf", marginLeft: 4 }}>
            /fx で登録
          </Link>
        </div>
      )}

      <KpiRow stats={stats} currency={currency} fmt={fmt} />

      <section style={{ marginTop: "1.8rem" }}>
        <h2 style={sectionTitle}>
          累積実現 PnL (全アカウント合算, {currencyLabel})
        </h2>
        {daily.length === 0 ? (
          <p style={{ color: "#666" }}>取引データがありません</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={daily}>
              <CartesianGrid stroke="#222838" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#888" fontSize={12} />
              <YAxis stroke="#888" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: "#141823",
                  border: "1px solid #2a3047",
                }}
                labelStyle={{ color: "#aab" }}
                formatter={(v) => (typeof v === "number" ? fmt(v) : String(v))}
              />
              <Line
                type="monotone"
                dataKey="cumulative"
                stroke="#6cf"
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      <section style={{ marginTop: "1.8rem" }}>
        <h2 style={sectionTitle}>コイン別 実現 PnL ({currencyLabel})</h2>
        {coinPnL.length === 0 ? (
          <p style={{ color: "#666" }}>取引データがありません</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={coinPnL}>
              <CartesianGrid stroke="#222838" strokeDasharray="3 3" />
              <XAxis dataKey="coin" stroke="#888" fontSize={12} />
              <YAxis stroke="#888" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: "#141823",
                  border: "1px solid #2a3047",
                }}
                labelStyle={{ color: "#aab" }}
                formatter={(v) => (typeof v === "number" ? fmt(v) : String(v))}
              />
              <Bar dataKey="realizedPnl">
                {coinPnL.map((c) => (
                  <Cell
                    key={c.coin}
                    fill={c.realizedPnl >= 0 ? "#5dd58c" : "#ff8c8c"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      <section style={{ marginTop: "1.8rem" }}>
        <h2 style={sectionTitle}>アカウント別 内訳 ({currencyLabel})</h2>
        <AccountsBreakdown
          accounts={accounts}
          trades={displayedTrades}
          fundings={fundings}
          transfers={transfers}
          fmt={fmt}
        />
      </section>
    </div>
  );
}

function CurrencyToggle({
  currency,
  onChange,
}: {
  currency: Currency;
  onChange: (c: Currency) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: "#888", fontSize: "0.78rem" }}>表示通貨</span>
      <div
        style={{
          display: "inline-flex",
          background: "#0f1218",
          border: "1px solid #2a3047",
          borderRadius: 6,
          padding: 2,
        }}
      >
        {(["USD", "JPY"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            style={{
              background: currency === opt ? "#2563eb" : "transparent",
              color: currency === opt ? "#fff" : "#aab",
              border: "none",
              borderRadius: 4,
              padding: "0.25rem 0.7rem",
              fontSize: "0.82rem",
              cursor: "pointer",
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function AccountsBreakdown({
  accounts,
  trades,
  fundings,
  transfers,
  fmt,
}: {
  accounts: AccountRow[];
  trades: TradeRow[];
  fundings: FundingRow[];
  transfers: TransferRow[];
  fmt: (n: number) => string;
}) {
  const rows = useMemo(() => {
    return accounts
      .map((a) => {
        const ats = trades.filter((t) => t.account === a.id);
        const afs = fundings.filter((f) => f.account === a.id);
        const ats2 = transfers.filter((tr) => tr.account === a.id);
        const stats = buildAccountStats(ats, afs, ats2);
        return { ...a, ...stats };
      })
      .sort((a, b) => b.realizedPnl - a.realizedPnl);
  }, [accounts, trades, fundings, transfers]);

  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "0.88rem",
      }}
    >
      <thead>
        <tr style={{ borderBottom: "1px solid #2a3047", color: "#aab" }}>
          <th style={th}>アカウント名</th>
          <th style={{ ...th, textAlign: "right" }}>取引数</th>
          <th style={{ ...th, textAlign: "right" }}>実現 PnL</th>
          <th style={{ ...th, textAlign: "right" }}>手数料</th>
          <th style={{ ...th, textAlign: "right" }}>ファンディング</th>
          <th style={{ ...th, textAlign: "right" }}>入出金</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderBottom: "1px solid #1a1f2c" }}>
            <td style={td}>
              <Link
                to={`/accounts/${r.id}`}
                style={{ color: "#6cf", textDecoration: "none" }}
              >
                {r.name}
              </Link>
            </td>
            <td style={tdRight}>{r.tradeCount}</td>
            <td
              style={{
                ...tdRight,
                color: r.realizedPnl >= 0 ? "#5dd58c" : "#ff8c8c",
              }}
            >
              {fmt(r.realizedPnl)}
            </td>
            <td style={tdRight}>{r.totalFees.toFixed(4)}</td>
            <td
              style={{
                ...tdRight,
                color: r.fundingNet >= 0 ? "#5dd58c" : "#ff8c8c",
              }}
            >
              {r.fundingNet.toFixed(4)}
            </td>
            <td style={tdRight}>{r.netDeposits.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KpiRow({
  stats,
  currency,
  fmt,
}: {
  stats: ReturnType<typeof buildAccountStats>;
  currency: Currency;
  fmt: (n: number) => string;
}) {
  const kpis = [
    {
      label: `実現 PnL (${currency})`,
      value: fmt(stats.realizedPnl),
      color: stats.realizedPnl >= 0 ? "#5dd58c" : "#ff8c8c",
    },
    {
      label: "手数料合計 (USD)",
      value: stats.totalFees.toLocaleString(undefined, {
        maximumFractionDigits: 4,
        minimumFractionDigits: 2,
      }),
      color: "#aab",
    },
    {
      label: "ファンディング純額 (USD)",
      value: stats.fundingNet.toLocaleString(undefined, {
        maximumFractionDigits: 4,
        minimumFractionDigits: 2,
      }),
      color: stats.fundingNet >= 0 ? "#5dd58c" : "#ff8c8c",
    },
    {
      label: "入出金純額 (USDC)",
      value: stats.netDeposits.toLocaleString(undefined, {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }),
      color: "#aab",
    },
    {
      label: "取引数",
      value: stats.tradeCount.toLocaleString(),
      color: "#aab",
    },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        gap: "0.8rem",
        marginTop: "1rem",
      }}
    >
      {kpis.map((k) => (
        <div
          key={k.label}
          style={{
            background: "#141823",
            border: "1px solid #2a3047",
            borderRadius: 8,
            padding: "0.8rem 1rem",
          }}
        >
          <div style={{ color: "#888", fontSize: "0.8rem" }}>{k.label}</div>
          <div
            style={{
              color: k.color,
              fontSize: "1.4rem",
              fontWeight: 600,
              marginTop: 4,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {k.value}
          </div>
        </div>
      ))}
    </div>
  );
}

