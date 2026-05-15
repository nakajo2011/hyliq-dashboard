import { useEffect, type ReactNode } from "react";
import { btnGhost, COLORS } from "../styles";

/**
 * Generic centered modal dialog. Closes on Escape, backdrop click, or the
 * 閉じる button. Content is supplied as children.
 */
export function Modal({
  title,
  onClose,
  children,
  maxWidth = 520,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "3rem 1rem",
        zIndex: 100,
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.bg,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 10,
          padding: "1.5rem",
          width: "100%",
          maxWidth,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "1rem",
            marginBottom: 14,
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{title}</h2>
          <button type="button" onClick={onClose} style={btnGhost}>
            閉じる
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
