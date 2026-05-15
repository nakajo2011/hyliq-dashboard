import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
import { pb } from "../lib/pb";
import { table, td, tdRight, th, trHead, trRow } from "../styles";
import {
  buildAccountStats,
  buildCoinPnL,
  buildDailyPnL,
  buildOpenPositions,
  dateKeyJst,
} from "../lib/pnl";
import type {
  CoinPnL,
  FundingLike,
  OpenPosition,
  TradeLike,
  TransferLike,
} from "../lib/pnl";

interface AccountRecord {
  id: string;
  name: string;
  address: string;
  note: string;
}

type TradeRow = TradeLike & { id: string; ntl: number };
type FundingRow = FundingLike & { id: string; sz: number; side: string };
type TransferRow = TransferLike & { id: string; taxable: boolean };

type LoadState =
  | { status: "loading" }
  | {
      status: "ready";
      account: AccountRecord;
      trades: TradeRow[];
      fundings: FundingRow[];
      transfers: TransferRow[];
    }
  | { status: "error"; message: string }
  | { status: "not-found" };

export function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const account = await pb
          .collection("accounts")
          .getOne<AccountRecord>(id);
        const filter = `account = "${id}"`;
        const [trades, fundings, transfers] = await Promise.all([
          pb
            .collection("trades")
            .getFullList<TradeRow>({ filter, sort: "+time" }),
          pb
            .collection("fundings")
            .getFullList<FundingRow>({ filter, sort: "+time" }),
          pb
            .collection("transfers")
            .getFullList<TransferRow>({ filter, sort: "+time" }),
        ]);
        if (cancelled) return;
        setState({ status: "ready", account, trades, fundings, transfers });
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: msg });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.status === "loading") return <p>読み込み中...</p>;
  if (state.status === "not-found")
    return (
      <p>
        アカウントが見つかりません。<Link to="/">収支へ戻る</Link>
      </p>
    );
  if (state.status === "error")
    return <p style={{ color: "#ff6b6b" }}>❌ {state.message}</p>;

  return <AccountDetailReady {...state} />;
}

interface ReadyProps {
  account: AccountRecord;
  trades: TradeRow[];
  fundings: FundingRow[];
  transfers: TransferRow[];
}

function AccountDetailReady({
  account,
  trades,
  fundings,
  transfers,
}: ReadyProps) {
  const stats = useMemo(
    () => buildAccountStats(trades, fundings, transfers),
    [trades, fundings, transfers]
  );
  const daily = useMemo(() => buildDailyPnL(trades), [trades]);
  const coinPnL = useMemo(() => buildCoinPnL(trades), [trades]);
  const openPositions = useMemo(() => buildOpenPositions(trades), [trades]);
  const recentTrades = useMemo(
    () =>
      [...trades]
        .sort((a, b) => b.time.localeCompare(a.time))
        .slice(0, 20),
    [trades]
  );

  return (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        <Link to="/" style={{ color: "#6cf" }}>
          ← 収支
        </Link>
      </div>
      <h1 style={{ marginTop: 0, wordBreak: "break-all" }}>{account.name}</h1>
      {account.address && (
        <div
          style={{
            color: "#888",
            fontFamily: "monospace",
            fontSize: "0.9rem",
          }}
        >
          {account.address}
        </div>
      )}

      <KpiRow stats={stats} />

      <Section title="累積実現 PnL (USD)">
        {daily.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart
              data={daily}
              margin={{ top: 10, right: 20, bottom: 10, left: 10 }}
            >
              <CartesianGrid stroke="#222838" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#888" fontSize={12} />
              <YAxis stroke="#888" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: "#141823",
                  border: "1px solid #2a3047",
                }}
                labelStyle={{ color: "#aab" }}
                formatter={(v) => (typeof v === "number" ? v.toFixed(2) : String(v))}
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
      </Section>

      <Section title="コイン別 実現 PnL">
        {coinPnL.length === 0 ? (
          <Empty />
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
                formatter={(v) => (typeof v === "number" ? v.toFixed(2) : String(v))}
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
      </Section>

      <Section title={`現在オープンポジション (${openPositions.length})`}>
        {openPositions.length === 0 ? (
          <Empty message="現在ポジションはありません" />
        ) : (
          <PositionsTable positions={openPositions} />
        )}
      </Section>

      <Section title="コイン別サマリ">
        {coinPnL.length === 0 ? <Empty /> : <CoinTable coins={coinPnL} />}
      </Section>

      <Section title={`直近の取引 (最新 ${recentTrades.length} 件)`}>
        {recentTrades.length === 0 ? (
          <Empty />
        ) : (
          <TradesTable trades={recentTrades} />
        )}
      </Section>

    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: "1.8rem" }}>
      <h2 style={{ marginBottom: "0.6rem", color: "#aab", fontSize: "1rem" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ message = "データがありません" }: { message?: string }) {
  return <p style={{ color: "#666", fontSize: "0.9rem" }}>{message}</p>;
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
    {
      label: "手数料合計",
      value: stats.totalFees,
      color: "#aab",
      prefix: "-",
    },
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
            {k.prefix ?? ""}
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

function PositionsTable({ positions }: { positions: OpenPosition[] }) {
  return (
    <table style={table}>
      <thead>
        <tr style={trHead}>
          <th style={th}>Coin</th>
          <th style={th}>Side</th>
          <th style={{ ...th, textAlign: "right" }}>Size</th>
          <th style={{ ...th, textAlign: "right" }}>Avg Entry</th>
          <th style={{ ...th, textAlign: "right" }}>Notional</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr key={`${p.coin}-${p.side}`} style={trRow}>
            <td style={td}>{p.coin}</td>
            <td
              style={{
                ...td,
                color: p.side === "long" ? "#5dd58c" : "#ff8c8c",
              }}
            >
              {p.side.toUpperCase()}
            </td>
            <td style={tdRight}>{p.size.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
            <td style={tdRight}>{p.avgEntry.toFixed(2)}</td>
            <td style={tdRight}>{p.notional.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CoinTable({ coins }: { coins: CoinPnL[] }) {
  return (
    <table style={table}>
      <thead>
        <tr style={trHead}>
          <th style={th}>Coin</th>
          <th style={{ ...th, textAlign: "right" }}>Trades</th>
          <th style={{ ...th, textAlign: "right" }}>Realized PnL</th>
          <th style={{ ...th, textAlign: "right" }}>Fees</th>
        </tr>
      </thead>
      <tbody>
        {coins.map((c) => (
          <tr key={c.coin} style={trRow}>
            <td style={td}>{c.coin}</td>
            <td style={tdRight}>{c.trades}</td>
            <td
              style={{
                ...tdRight,
                color: c.realizedPnl >= 0 ? "#5dd58c" : "#ff8c8c",
              }}
            >
              {c.realizedPnl.toFixed(2)}
            </td>
            <td style={tdRight}>{c.fees.toFixed(4)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TradesTable({ trades }: { trades: TradeRow[] }) {
  return (
    <table style={table}>
      <thead>
        <tr style={trHead}>
          <th style={th}>Time (JST)</th>
          <th style={th}>Coin</th>
          <th style={th}>Dir</th>
          <th style={{ ...th, textAlign: "right" }}>Px</th>
          <th style={{ ...th, textAlign: "right" }}>Sz</th>
          <th style={{ ...th, textAlign: "right" }}>Notional</th>
          <th style={{ ...th, textAlign: "right" }}>Fee</th>
          <th style={{ ...th, textAlign: "right" }}>Closed PnL</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => (
          <tr key={t.id} style={trRow}>
            <td style={td}>{formatTime(t.time)}</td>
            <td style={td}>{t.coin}</td>
            <td
              style={{
                ...td,
                color: t.dir.includes("Long") ? "#5dd58c" : "#ff8c8c",
              }}
            >
              {t.dir}
            </td>
            <td style={tdRight}>{t.px.toFixed(2)}</td>
            <td style={tdRight}>
              {t.sz.toLocaleString(undefined, { maximumFractionDigits: 6 })}
            </td>
            <td style={tdRight}>{t.ntl.toFixed(2)}</td>
            <td style={tdRight}>{t.fee.toFixed(4)}</td>
            <td
              style={{
                ...tdRight,
                color: t.closed_pnl >= 0 ? "#5dd58c" : "#ff8c8c",
              }}
            >
              {t.closed_pnl.toFixed(4)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatTime(iso: string): string {
  // Show in JST without seconds for brevity.
  const date = dateKeyJst(iso);
  // Extract time portion
  const m = iso.match(
    /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|\+09:00)?/
  );
  if (!m) return iso;
  const [, , , , h, mi, , tz] = m;
  if (tz === "+09:00" || !tz) return `${date} ${h}:${mi}`;
  // UTC → JST
  const d = new Date(iso.replace(" ", "T"));
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${date} ${hh}:${mm}`;
}

