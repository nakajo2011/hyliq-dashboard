import { NavLink, Outlet } from "react-router-dom";

const navItemStyle = ({ isActive }: { isActive: boolean }) => ({
  padding: "0.5rem 0.9rem",
  borderRadius: 6,
  color: isActive ? "#fff" : "#aab",
  background: isActive ? "#2a3047" : "transparent",
  textDecoration: "none",
  fontSize: "0.95rem",
});

export function Layout() {
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
        <strong style={{ fontSize: "1.05rem" }}>Hyliq Dashboard</strong>
        <nav style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
          <NavLink to="/" style={navItemStyle} end>
            Home
          </NavLink>
          <NavLink to="/upload" style={navItemStyle}>
            Upload
          </NavLink>
          <NavLink to="/accounts" style={navItemStyle}>
            Accounts
          </NavLink>
          <NavLink to="/fx" style={navItemStyle}>
            FX
          </NavLink>
          <NavLink to="/reports/tax" style={navItemStyle}>
            確定申告
          </NavLink>
        </nav>
      </header>
      <main style={{ padding: "1.5rem", maxWidth: 1100, margin: "0 auto" }}>
        <Outlet />
      </main>
    </div>
  );
}
