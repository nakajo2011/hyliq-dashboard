import type { CSSProperties } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

const navItem = (active: boolean): CSSProperties => ({
  padding: "0.5rem 0.9rem",
  borderRadius: 6,
  color: active ? "#fff" : "#aab",
  background: active ? "#2a3047" : "transparent",
  textDecoration: "none",
  fontSize: "0.95rem",
});

export function Layout() {
  const { pathname } = useLocation();

  // 収支 covers the overall dashboard ("/") and per-account P&L
  // ("/accounts/:id"). Settings covers everything under "/settings".
  const isPnl = pathname === "/" || pathname.startsWith("/accounts/");
  const isTax = pathname.startsWith("/reports");
  const isSettings = pathname.startsWith("/settings");

  return (
    <div style={{ minHeight: "100vh" }}>
      <header
        style={{
          borderBottom: "1px solid #222838",
          padding: "0.8rem 1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "1.5rem",
        }}
      >
        <Link
          to="/"
          style={{
            fontSize: "1.05rem",
            fontWeight: 700,
            color: "#fff",
            textDecoration: "none",
          }}
        >
          Hyliq Dashboard
        </Link>
        <nav style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
          <Link to="/" style={navItem(isPnl)}>
            収支
          </Link>
          <Link to="/reports/tax" style={navItem(isTax)}>
            確定申告
          </Link>
          <Link to="/settings/accounts" style={navItem(isSettings)}>
            ⚙ 設定
          </Link>
        </nav>
      </header>
      <main style={{ padding: "1.5rem", maxWidth: 1100, margin: "0 auto" }}>
        <Outlet />
      </main>
    </div>
  );
}
