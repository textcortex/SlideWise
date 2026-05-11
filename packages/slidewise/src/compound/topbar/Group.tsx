import type { CSSProperties, PropsWithChildren } from "react";

/**
 * Visual cluster wrapper for a related set of buttons (e.g. Undo + Redo).
 * Just a flex row with a small inner gap — keeps clusters visually together
 * separate from the bar's default 10px gap.
 *
 * ```tsx
 * <Slidewise.TopBar.Group>
 *   <Slidewise.TopBar.Undo />
 *   <Slidewise.TopBar.Redo />
 * </Slidewise.TopBar.Group>
 * ```
 */
export interface TopBarGroupProps {
  className?: string;
  style?: CSSProperties;
  /** Gap between children inside the group. Default 2px. */
  gap?: number;
}

export function Group({
  className,
  style,
  gap = 2,
  children,
}: PropsWithChildren<TopBarGroupProps>) {
  return (
    <div
      className={className}
      style={{ display: "flex", alignItems: "center", gap, ...style }}
    >
      {children}
    </div>
  );
}
