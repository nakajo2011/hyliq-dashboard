import { useEffect, useState } from "react";
import { pb, PB_URL } from "./lib/pb";
import "./App.css";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

function App() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  const [collections, setCollections] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await pb.health.check();
        if (cancelled) return;
        setHealth({ status: "ok", message: res.message ?? "OK" });
      } catch (err) {
        if (cancelled) return;
        setHealth({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      const expected = ["accounts", "trades", "fundings", "transfers", "fx_rates"];
      const found: string[] = [];
      for (const name of expected) {
        try {
          await pb.collection(name).getList(1, 1);
          found.push(name);
        } catch {
          // collection missing or no permission
        }
      }
      if (!cancelled) setCollections(found);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Hyliq Dashboard</h1>
      <p style={{ color: "#666" }}>
        Hyperliquid Perp 取引損益ダッシュボード (Phase 1: 環境構築確認)
      </p>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>PocketBase 接続状況</h2>
        <p>
          <strong>URL:</strong> <code>{PB_URL}</code>
        </p>
        <p>
          <strong>ヘルスチェック:</strong>{" "}
          {health.status === "loading" && "確認中..."}
          {health.status === "ok" && (
            <span style={{ color: "green" }}>✅ {health.message}</span>
          )}
          {health.status === "error" && (
            <span style={{ color: "crimson" }}>❌ {health.message}</span>
          )}
        </p>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>確認されたコレクション</h2>
        {health.status !== "ok" ? (
          <p style={{ color: "#999" }}>PocketBase に接続できたら表示されます</p>
        ) : collections.length === 0 ? (
          <p style={{ color: "crimson" }}>
            コレクションが見つかりません。migration が走っているか確認してください。
          </p>
        ) : (
          <ul>
            {collections.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default App;
