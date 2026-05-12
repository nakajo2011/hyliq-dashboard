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
} from "../lib/pnl";
import type {
  FundingLike,
  TradeLike,
  TransferLike,
} from "../lib/pnl";

interface AccountRow {
  id: string;
  address: string;
  label: string;
}
type TradeRow = TradeLike & { id: string; account: string };
type FundingRow = FundingLike & { id: string; account: string };
type TransferRow = TransferLike & { id: string; account: string };

type State =
  | { status: "loading" }
  | { status: "no-data"; healthOk: boolean }
  | {
      status: "ready";
      accounts: AccountRow[];
      trades: TradeRow[];
      fundings: FundingRow[];
      transfers: TransferRow[];
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
          .getFullList<AccountRow>({ sort: "address" });
        if (accounts.length === 0) {
          if (!cancelled) setState({ status: "no-data", healthOk: true });
          return;
        }
        const [trades, fundings, transfers] = await Promise.all([
          pb.collection("trades").getFullList<TradeRow>({ sort: "+time" }),
          pb.collection("fundings").getFullList<FundingRow>({ sort: "+time" }),
          pb
            .collection("transfers")
            .getFullList<TransferRow>({ sort: "+time" }),
        ]);
        if (cancelled) return;
        setState({ status: "ready", accounts, trades, fundings, transfers });
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

function Dashboard({
  state,
}: {
  state: Extract<State, { status: "ready" }>;
}) {
  const { accounts, trades, fundings, transfers } = state;

  const stats = useMemo(
    () => buildAccountStats(trades, fundings, transfers),
    [trades, fundings, transfers]
  );
  const daily = useMemo(() => buildDailyPnL(trades), [trades]);
  const coinPnL = useMemo(() => buildCoinPnL(trades), [trades]);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Home</h1>
      <p style={{ color: "#888" }}>
        {accounts.length} アカウントの合算サマリ。{" "}
        <Link to="/accounts" style={{ color: "#6cf" }}>
          各アカウント詳細へ
        </Link>
      </p>

      <KpiRow stats={stats} />

      <section style={{ marginTop: "1.8rem" }}>
        <h2 style={sectionTitle}>累積実現 PnL (全アカウント合算, USD)</h2>
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
                formatter={(v) =>
                  typeof v === "number" ? v.toFixed(2) : String(v)
                }
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
        <h2 style={sectionTitle}>コイン別 実現 PnL</h2>
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
                formatter={(v) =>
                  typeof v === "number" ? v.toFixed(2) : String(v)
                }
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
        <h2 style={sectionTitle}>アカウント別 内訳</h2>
        <AccountsBreakdown
          accounts={accounts}
          trades={trades}
          fundings={fundings}
          transfers={transfers}
        />
      </section>
    </div>
  );
}

function AccountsBreakdown({
  accounts,
  trades,
  fundings,
  transfers,
}: {
  accounts: AccountRow[];
  trades: TradeRow[];
  fundings: FundingRow[];
  transfers: TransferRow[];
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
          <th style={th}>アドレス</th>
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
            <td style={{ ...td, fontFamily: "monospace" }}>
              <Link
                to={`/accounts/${r.id}`}
                style={{ color: "#6cf", textDecoration: "none" }}
              >
                {r.label || `${r.address.slice(0, 10)}...${r.address.slice(-6)}`}
              </Link>
            </td>
            <td style={tdRight}>{r.tradeCount}</td>
            <td
              style={{
                ...tdRight,
                color: r.realizedPnl >= 0 ? "#5dd58c" : "#ff8c8c",
              }}
            >
              {r.realizedPnl.toFixed(2)}
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
}: {
  stats: ReturnType<typeof buildAccountStats>;
}) {
  const kpis = [
    {
      label: "実現 PnL (USD)",
      value: stats.realizedPnl,
      color: stats.realizedPnl >= 0 ? "#5dd58c" : "#ff8c8c",
    },
    { label: "手数料合計", value: stats.totalFees, color: "#aab" },
    {
      label: "ファンディング純額",
      value: stats.fundingNet,
      color: stats.fundingNet >= 0 ? "#5dd58c" : "#ff8c8c",
    },
    {
      label: "入出金純額 (USDC)",
      value: stats.netDeposits,
      color: "#aab",
    },
    {
      label: "取引数",
      value: stats.tradeCount,
      color: "#aab",
      decimals: 0,
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
            {k.value.toLocaleString(undefined, {
              maximumFractionDigits: k.decimals ?? 2,
              minimumFractionDigits: k.decimals ?? 2,
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  marginBottom: "0.6rem",
  color: "#aab",
  fontSize: "1rem",
};
const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.55rem 0.6rem",
  fontWeight: 500,
  fontSize: "0.78rem",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const td: React.CSSProperties = {
  padding: "0.5rem 0.6rem",
  verticalAlign: "middle",
};
const tdRight: React.CSSProperties = {
  ...td,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
