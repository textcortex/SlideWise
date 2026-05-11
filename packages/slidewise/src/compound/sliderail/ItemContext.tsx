import { createContext, useContext } from "react";
import type { Slide } from "@/lib/types";

/**
 * Context handed to descendants of `<SlideRail.Item>` so leaf subparts
 * (`Thumbnail`, `Number`) and host content can read which slide they're
 * rendering against without prop drilling.
 */
export interface SlideRailItemContextValue {
  slide: Slide;
  /** Zero-based position in `deck.slides`. */
  index: number;
  /** True when this is the editor's currently-focused slide. */
  isCurrent: boolean;
}

const ItemContext = createContext<SlideRailItemContextValue | null>(null);

export function SlideRailItemProvider({
  value,
  children,
}: {
  value: SlideRailItemContextValue;
  children: React.ReactNode;
}) {
  return <ItemContext.Provider value={value}>{children}</ItemContext.Provider>;
}

/**
 * Read the current item context. Throws when used outside a
 * `<SlideRail.Item>` — the leaf subparts are meaningless without a
 * concrete slide to render.
 */
export function useSlideRailItem(): SlideRailItemContextValue {
  const ctx = useContext(ItemContext);
  if (!ctx) {
    throw new Error(
      "useSlideRailItem must be used inside <Slidewise.SlideRail.Item>"
    );
  }
  return ctx;
}
