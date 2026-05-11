import type { CSSProperties } from "react";
import { SlideView } from "@/components/editor/SlideView";
import { SLIDE_W } from "@/lib/types";
import { useSlideRailItem } from "./ItemContext";

const DEFAULT_THUMB_W = 132;

/**
 * Renders the slide preview inside the rail item. Reads the current slide
 * from `<SlideRail.Item>`'s context. Honors the focused/non-focused state
 * via an accent border.
 *
 * ```tsx
 * <Slidewise.SlideRail.Item slide={slide}>
 *   <Slidewise.SlideRail.Thumbnail />
 * </Slidewise.SlideRail.Item>
 * ```
 */
export interface SlideRailThumbnailProps {
  className?: string;
  style?: CSSProperties;
  /** Pixel width for the rendered thumbnail. Defaults to 132. */
  width?: number;
}

export function Thumbnail({
  className,
  style,
  width = DEFAULT_THUMB_W,
}: SlideRailThumbnailProps = {}) {
  const { slide, isCurrent } = useSlideRailItem();
  const scale = width / SLIDE_W;

  return (
    <div style={{ position: "relative" }}>
      <div
        className={className}
        style={{
          display: "block",
          width,
          border: isCurrent
            ? "2px solid var(--slidewise-accent, var(--accent))"
            : "2px solid transparent",
          borderRadius: 8,
          padding: 0,
          background: "transparent",
          overflow: "hidden",
          transition: "border-color 120ms",
          ...style,
        }}
      >
        <div style={{ pointerEvents: "none" }}>
          <SlideView slide={slide} scale={scale} />
        </div>
      </div>
    </div>
  );
}
