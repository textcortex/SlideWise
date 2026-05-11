import type { CSSProperties, PropsWithChildren } from "react";

/**
 * Container for the TopBar subparts. Owns the bar's height, padding, theme
 * background, and shadow. Hosts replace this when they want a different
 * shell shape (taller bar, different alignment, etc.); otherwise just render
 * subparts inside it.
 *
 * ```tsx
 * <Slidewise.TopBar.Root>
 *   <Slidewise.TopBar.Title />
 *   <Slidewise.TopBar.Spacer />
 *   <Slidewise.TopBar.Save />
 * </Slidewise.TopBar.Root>
 * ```
 */
export interface TopBarRootProps {
  className?: string;
  style?: CSSProperties;
}

export function Root({
  className,
  style,
  children,
}: PropsWithChildren<TopBarRootProps>) {
  return (
    <div
      className={
        className ? `slidewise-topbar ${className}` : "slidewise-topbar"
      }
      style={{
        height: 56,
        display: "flex",
        alignItems: "center",
        padding: "0 14px",
        gap: 10,
        background:
          "var(--slidewise-bg-topbar, var(--slidewise-bar-bg, var(--app-bg)))",
        borderBottom: "1px solid var(--border)",
        boxShadow: "var(--topbar-shadow)",
        fontFamily: "Inter, system-ui, sans-serif",
        position: "relative",
        zIndex: 10,
        color: "var(--ink)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
