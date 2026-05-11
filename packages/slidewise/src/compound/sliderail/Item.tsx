import type { CSSProperties, PropsWithChildren } from "react";
import { useEditor } from "@/lib/StoreProvider";
import type { Slide } from "@/lib/types";
import { SlideRailItemProvider } from "./ItemContext";

/**
 * Wraps a single slide in the rail. Provides the slide to descendants via
 * context (read with `useSlideRailItem`) and wires click → `selectSlide`.
 *
 * The default subparts (`Thumbnail`, `Number`) read the slide off the
 * context, so hosts can rearrange them freely. Host content (e.g. a
 * three-dots menu, a duplicate button) drops in as additional children.
 *
 * ```tsx
 * <Slidewise.SlideRail.Item slide={slide}>
 *   <Slidewise.SlideRail.Thumbnail />
 *   <Slidewise.SlideRail.Number />
 *   <MyContextMenu slide={slide} />
 * </Slidewise.SlideRail.Item>
 * ```
 */
export interface SlideRailItemProps {
  slide: Slide;
  className?: string;
  style?: CSSProperties;
  /**
   * Override the click handler. The default selects the slide via the
   * editor store; pass a function here to add host behavior (e.g. open
   * a context drawer instead of selecting).
   */
  onClick?: (slide: Slide) => void;
}

export function Item({
  slide,
  className,
  style,
  onClick,
  children,
}: PropsWithChildren<SlideRailItemProps>) {
  const slides = useEditor((s) => s.deck.slides);
  const currentId = useEditor((s) => s.currentSlideId);
  const selectSlide = useEditor((s) => s.selectSlide);
  const index = slides.findIndex((s) => s.id === slide.id);
  const isCurrent = slide.id === currentId;

  return (
    <SlideRailItemProvider value={{ slide, index, isCurrent }}>
      <div
        className={className}
        onClick={() => (onClick ? onClick(slide) : selectSlide(slide.id))}
        role="button"
        tabIndex={0}
        aria-current={isCurrent ? "true" : undefined}
        aria-label={`Open slide ${index + 1}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick ? onClick(slide) : selectSlide(slide.id);
          }
        }}
        style={{
          position: "relative",
          padding: "0 12px",
          marginBottom: 14,
          cursor: "pointer",
          background:
            "var(--slidewise-bg-rail-item, transparent)",
          ...(isCurrent
            ? {
                background:
                  "var(--slidewise-bg-rail-item-active, var(--accent-soft))",
              }
            : null),
          ...style,
        }}
      >
        {children}
      </div>
    </SlideRailItemProvider>
  );
}
