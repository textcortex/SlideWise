import type { CSSProperties, ReactNode } from "react";
import { useEditor } from "@/lib/StoreProvider";
import type { Slide } from "@/lib/types";
import { Item } from "./Item";
import { Thumbnail } from "./Thumbnail";
import { Number as SlideNumber } from "./Number";

/**
 * Iterates `deck.slides` and renders each one. Pass a render-prop child
 * for full control over what each row contains; omit the child to get
 * the default `<Item><Thumbnail /><Number /></Item>` layout.
 *
 * ```tsx
 * // Default
 * <Slidewise.SlideRail.List />
 *
 * // Custom — add a per-row context menu
 * <Slidewise.SlideRail.List>
 *   {(slide) => (
 *     <Slidewise.SlideRail.Item slide={slide}>
 *       <Slidewise.SlideRail.Thumbnail />
 *       <Slidewise.SlideRail.Number />
 *       <MyContextMenu slide={slide} />
 *     </Slidewise.SlideRail.Item>
 *   )}
 * </Slidewise.SlideRail.List>
 * ```
 */
export interface SlideRailListProps {
  className?: string;
  style?: CSSProperties;
  /**
   * Optional render-prop. Receives each slide + its zero-based index;
   * return the row content. When omitted, the default row layout
   * is used.
   */
  children?: (slide: Slide, index: number) => ReactNode;
}

export function List({ className, style, children }: SlideRailListProps) {
  const slides = useEditor((s) => s.deck.slides);

  return (
    <div
      className={className}
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "12px 0",
        ...style,
      }}
    >
      {slides.map((slide, index) =>
        children ? (
          // Render-prop branch: host returns whatever they want, typically
          // wrapping their JSX in a SlideRail.Item to wire selection.
          <div key={slide.id}>{children(slide, index)}</div>
        ) : (
          <Item key={slide.id} slide={slide}>
            <Thumbnail />
            <SlideNumber />
          </Item>
        )
      )}
    </div>
  );
}
