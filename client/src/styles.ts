/**
 * Shared inline-style constants. The app uses a dark color palette with a
 * blue accent; these objects are reused across pages so that visual
 * inconsistency from copy-pasted snippets doesn't drift.
 *
 * If/when the project adopts Tailwind or another styling system, this file
 * is the single point of replacement.
 */

import type { CSSProperties } from "react";

// ---------- Color tokens ----------
export const COLORS = {
  /** App background. */
  bg: "#0f1115",
  /** Panel/card background. */
  panel: "#141823",
  /** Slightly different panel background (e.g. common-settings bar). */
  panelAlt: "#1c2030",
  /** Input field background. */
  inputBg: "#0f1218",
  /** Default border. */
  border: "#2a3047",
  /** Subtle grid lines on charts. */
  grid: "#222838",
  /** Body text. */
  text: "#e6e6e6",
  /** De-emphasized text (labels, hints). */
  muted: "#aab",
  /** Even more subtle (placeholders, tertiary). */
  subtle: "#888",
  /** Very subtle (captions, disabled). */
  faint: "#666",
  /** Positive / success (green). */
  pos: "#5dd58c",
  /** Negative / danger (red). */
  neg: "#ff8c8c",
  /** Warning (yellow). */
  warn: "#f5d678",
  /** Link / primary action (blue). */
  link: "#6cf",
  /** Primary button background. */
  primary: "#2563eb",
  /** Danger border. */
  dangerBorder: "#6b2a2a",
} as const;

/** Helper: red/green by sign. */
export const signColor = (n: number) => (n >= 0 ? COLORS.pos : COLORS.neg);

// ---------- Layout / sections ----------
export const section: CSSProperties = {
  marginTop: "1.5rem",
  padding: "1rem",
  background: COLORS.panel,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
};

/** Section h2 (also reused by chart titles etc.) */
export const h2: CSSProperties = {
  marginTop: 0,
  marginBottom: "0.6rem",
  fontSize: "1rem",
  color: COLORS.muted,
};

export const lbl: CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  color: COLORS.muted,
  marginBottom: 4,
};

// ---------- Form inputs ----------
export const input: CSSProperties = {
  background: COLORS.inputBg,
  color: COLORS.text,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  padding: "0.4rem 0.6rem",
};

// ---------- Buttons ----------
export const btnPrimary: CSSProperties = {
  background: COLORS.primary,
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "0.45rem 0.9rem",
  cursor: "pointer",
};

export const btnDisabled: CSSProperties = {
  ...btnPrimary,
  background: COLORS.border,
  color: COLORS.faint,
  cursor: "not-allowed",
};

export const btnGhost: CSSProperties = {
  background: "transparent",
  color: COLORS.muted,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  padding: "0.3rem 0.7rem",
  cursor: "pointer",
};

export const btnGhostDisabled: CSSProperties = {
  ...btnGhost,
  color: "#555",
  cursor: "not-allowed",
};

export const btnDanger: CSSProperties = {
  background: "transparent",
  color: COLORS.neg,
  border: `1px solid ${COLORS.dangerBorder}`,
  borderRadius: 6,
  padding: "0.4rem 0.8rem",
  cursor: "pointer",
  fontSize: "0.9rem",
};

export const btnDangerDisabled: CSSProperties = {
  ...btnDanger,
  color: "#555",
  cursor: "not-allowed",
};

// ---------- Tables ----------
export const table: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.88rem",
};

export const trHead: CSSProperties = {
  borderBottom: `1px solid ${COLORS.border}`,
  color: COLORS.muted,
};

export const trRow: CSSProperties = {
  borderBottom: "1px solid #1a1f2c",
};

export const th: CSSProperties = {
  textAlign: "left",
  padding: "0.55rem 0.6rem",
  fontWeight: 500,
  fontSize: "0.78rem",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

export const tdRightHead: CSSProperties = { ...th, textAlign: "right" };

export const td: CSSProperties = {
  padding: "0.55rem 0.6rem",
  verticalAlign: "middle",
};

export const tdRight: CSSProperties = {
  ...td,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

// ---------- Chart helpers ----------
export const chartTooltip: CSSProperties = {
  background: COLORS.panel,
  border: `1px solid ${COLORS.border}`,
};

export const chartLabel: CSSProperties = {
  color: COLORS.muted,
};
