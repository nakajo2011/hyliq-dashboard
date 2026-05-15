import type { CSSProperties } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { COLORS } from "../styles";

/**
 * Wrapper for the "設定" area. Holds management-only features (account
 * CRUD + sync, CSV import, FX rates) behind a sub-tab nav so the main
 * header stays minimal (収支 / 確定申告 / 設定).
 */

const tabStyle = ({ isActive }: { isActive: boolean }): CSSProperties => ({
  padding: "0.4rem 0.95rem",
  borderRadius: 6,
  textDecoration: "none",
  fontSize: "0.9rem",
  color: isActive ? "#fff" : COLORS.muted,
  background: isActive ? COLORS.primary : "transparent",
  border: `1px solid ${isActive ? COLORS.primary : COLORS.border}`,
});

const TABS = [
  { to: "/settings/accounts", label: "アカウント" },
  { to: "/settings/import", label: "CSV取込" },
  { to: "/settings/fx", label: "為替レート" },
];

export function SettingsLayout() {
  return (
    <div>
      <nav
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: "1.6rem",
          paddingBottom: "1rem",
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} style={tabStyle}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
