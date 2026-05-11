import type { CSSProperties } from "react";

/**
 * Shared button styles for TopBar subparts. Kept here so a host that swaps
 * out one subpart (e.g. their own Save button) can match the visual weight
 * of the remaining built-in subparts by importing these and applying them.
 */

export function chromeBtnStyle(): CSSProperties {
  return {
    height: 32,
    padding: "0 12px",
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--slidewise-radius, 10px)",
    cursor: "pointer",
    color: "var(--ink)",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "inherit",
  };
}

export function iconBtnStyle(): CSSProperties {
  return {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--ink)",
    fontFamily: "inherit",
  };
}

export function primaryBtnStyle(): CSSProperties {
  return {
    height: 32,
    padding: "0 12px",
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "var(--primary-bg)",
    border: "1px solid var(--primary-bg)",
    borderRadius: "var(--slidewise-radius, 10px)",
    cursor: "pointer",
    color: "var(--primary-fg)",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "inherit",
  };
}

export function hoverHandlers(bg: string = "var(--hover)") {
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      (e.currentTarget as HTMLElement).style.background = bg;
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      (e.currentTarget as HTMLElement).style.background = "transparent";
    },
  };
}

export function primaryHoverHandlers() {
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      (e.currentTarget as HTMLElement).style.background = "var(--primary-bg-hover)";
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      (e.currentTarget as HTMLElement).style.background = "var(--primary-bg)";
    },
  };
}
