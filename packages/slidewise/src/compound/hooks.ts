/**
 * Public store hooks. These let host components anywhere inside
 * `<Slidewise.Root>` read or write editor state without prop drilling.
 *
 * `useEditor` is the generic selector hook — pass any function that takes
 * the editor state and returns the slice you care about. The convenience
 * hooks below cover the common cases.
 *
 * Example:
 *
 * ```tsx
 * import { useEditor, useSlides, useActiveSlide } from "@textcortex/slidewise";
 *
 * function HostHeader() {
 *   const slideCount = useSlides().length;
 *   const active = useActiveSlide();
 *   return <span>Slide {active.id} of {slideCount}</span>;
 * }
 * ```
 */
import { useEditor } from "@/lib/StoreProvider";
import type { Slide, SlideElement } from "@/lib/types";

export { useEditor, useEditorStore } from "@/lib/StoreProvider";

/** All slides in the current deck, in display order. */
export function useSlides(): Slide[] {
  return useEditor((s) => s.deck.slides);
}

/**
 * The currently focused slide. Falls back to the first slide if the
 * `currentSlideId` no longer exists (shouldn't happen, but defensive).
 */
export function useActiveSlide(): Slide {
  return useEditor((s) => {
    const found = s.deck.slides.find((sl) => sl.id === s.currentSlideId);
    return found ?? s.deck.slides[0];
  });
}

/** Id of the currently focused slide. */
export function useActiveSlideId(): string {
  return useEditor((s) => s.currentSlideId);
}

/** Ids of currently selected elements on the active slide. */
export function useSelection(): string[] {
  return useEditor((s) => s.selectedIds);
}

/**
 * Resolved selected element objects on the active slide. Returns `[]` when
 * nothing is selected. Use this when you need to read element properties
 * (position, text, fill) — not just their ids.
 */
export function useSelectedElements(): SlideElement[] {
  return useEditor((s) => {
    const slide = s.deck.slides.find((sl) => sl.id === s.currentSlideId);
    if (!slide) return [];
    return slide.elements.filter((e) => s.selectedIds.includes(e.id));
  });
}

/** Current theme ("light" or "dark"). */
export function useTheme(): "light" | "dark" {
  return useEditor((s) => s.theme);
}

/** Current zoom scale (1 = 100%). */
export function useZoom(): number {
  return useEditor((s) => s.zoom);
}

/** True when the editor is in present-mode. */
export function usePlaying(): boolean {
  return useEditor((s) => s.playing);
}

/** Live history depth — useful for host-rendered Undo/Redo button state. */
export function useHistory(): {
  canUndo: boolean;
  canRedo: boolean;
  undoSize: number;
  redoSize: number;
} {
  return useEditor((s) => ({
    canUndo: s.history.length > 0,
    canRedo: s.future.length > 0,
    undoSize: s.history.length,
    redoSize: s.future.length,
  }));
}
