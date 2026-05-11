import type { CSSProperties, PropsWithChildren } from "react";

export const SLIDERAIL_DEFAULT_WIDTH = 168;

/**
 * Container for the slide rail subparts. Owns the rail's width, surface
 * color, and divider. Hosts replace this when they want a different rail
 * geometry (wider, narrower, full-bleed, etc.) — otherwise just render
 * subparts inside it.
 *
 * ```tsx
 * <Slidewise.SlideRail.Root>
 *   <Slidewise.SlideRail.Header />
 *   <Slidewise.SlideRail.List />
 *   <Slidewise.SlideRail.AddButton />
 * </Slidewise.SlideRail.Root>
 * ```
 */
export interface SlideRailRootProps {
  className?: string;
  style?: CSSProperties;
  /** Rail width in pixels. Defaults to 168. */
  width?: number | string;
}

export function Root({
  className,
  style,
  width = SLIDERAIL_DEFAULT_WIDTH,
  children,
}: PropsWithChildren<SlideRailRootProps>) {
  return (
    <div
      className={
        className ? `slidewise-rail ${className}` : "slidewise-rail"
      }
      style={{
        width,
        flexShrink: 0,
        background: "var(--slidewise-bg-rail, var(--rail-bg))",
        borderRight: "1px solid var(--border)",
        boxShadow: "var(--rail-shadow)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, system-ui, sans-serif",
        overflow: "hidden",
        zIndex: 5,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
