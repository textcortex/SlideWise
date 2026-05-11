import type { CSSProperties } from "react";
import { useSlideRailItem } from "./ItemContext";

/**
 * Renders the slide's "01" / "02" badge in the top-left corner of the rail
 * item. Reads the current slide's index from `<SlideRail.Item>`'s context.
 *
 * Render after `<SlideRail.Thumbnail>` so it stacks on top (or position
 * it manually via `style`).
 */
export interface SlideRailNumberProps {
  className?: string;
  style?: CSSProperties;
  /**
   * Format the displayed number. Default is zero-padded to width 2
   * (`01`, `02`, …, `10`).
   */
  format?: (index: number) => string;
}

const defaultFormat = (i: number) => String(i + 1).padStart(2, "0");

export function Number({
  className,
  style,
  format = defaultFormat,
}: SlideRailNumberProps = {}) {
  const { index, isCurrent } = useSlideRailItem();

  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        position: "absolute",
        left: 20,
        top: 6,
        zIndex: 2,
        width: 22,
        height: 22,
        borderRadius: 5,
        background: isCurrent ? "var(--ink)" : "#6B7280",
        color: isCurrent ? "var(--app-bg)" : "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "Inter, system-ui, sans-serif",
        pointerEvents: "none",
        ...style,
      }}
    >
      {format(index)}
    </span>
  );
}
