import { forwardRef, type CSSProperties } from "react";
import {
  Root,
  type SlidewiseRootHandle,
  type SlidewiseRootProps,
  type HistoryState,
} from "./compound/SlidewiseRoot";
import {
  TopBar,
  SlideRail,
  Canvas,
  BottomToolbar,
  Body,
  CanvasFrame,
} from "./compound/parts";
import type { SlidewiseIcons } from "./compound/IconContext";
import type { Deck } from "@/lib/types";
import "./SlidewiseEditor.css";

export interface SlidewiseEditorProps {
  /**
   * The deck to edit. Loaded into the editor on mount. If a different
   * Deck reference is later passed, the editor's internal state is reset
   * to it (dirty flag reset). Do NOT pass a new reference on every
   * `onChange` — that would loop. Hold the deck in a stable ref, and
   * only pass a new one when you intentionally want to reset the editor
   * (e.g. discard changes, load a different file).
   */
  deck: Deck;
  /** Fires after every committed mutation; receives the updated deck. */
  onChange?: (deck: Deck) => void;
  /** Fires when the user clicks "Save" in the top bar. */
  onSave?: (deck: Deck) => void | Promise<void>;
  /** Optional override for the default `.slidewise.json` export. */
  onExport?: (deck: Deck) => void;
  /** Fires when the dirty flag flips. Useful for "unsaved changes" banners. */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Fires whenever the undo/redo stack depths change. Use this to enable/disable
   * Undo and Redo buttons reactively without polling `api.canUndo()`.
   */
  onHistoryChange?: (state: HistoryState) => void;
  /** Reserved for future use; not enforced yet. */
  readOnly?: boolean;
  /** "light" or "dark"; defaults to "light". Ignored after first render. */
  theme?: "light" | "dark";
  /** Slide id to land on; falls back to the first slide. */
  initialSlideId?: string;
  /** Render the built-in top bar (title, undo/redo, save, play). Default true. */
  showTopBar?: boolean;
  /** Render the floating bottom toolbar (tool selector). Default true. */
  showBottomToolbar?: boolean;
  /** Override the bundled Geist font; sets `--font-geist-sans` on the root. */
  fontFamily?: string;
  /**
   * Per-action icon overrides. Pass a ReactNode for any of `undo`, `redo`,
   * `save`, `play`, `themeLight`, `themeDark`, `export`, `smart` to skin the
   * editor's chrome with your own icon set; missing slots fall back to the
   * bundled lucide-react icons.
   */
  icons?: SlidewiseIcons;
  /** Extra class names appended to the editor root. */
  className?: string;
  /** Inline style applied to the editor root. */
  style?: CSSProperties;
}

export type SlidewiseEditorHandle = SlidewiseRootHandle;

/**
 * Convenience wrapper that renders the default editor layout. Equivalent to:
 *
 * ```tsx
 * <Slidewise.Root deck={deck} onChange={...}>
 *   <Slidewise.TopBar />
 *   <Slidewise.Body>
 *     <Slidewise.SlideRail />
 *     <Slidewise.CanvasFrame>
 *       <Slidewise.Canvas />
 *       <Slidewise.BottomToolbar />
 *     </Slidewise.CanvasFrame>
 *   </Slidewise.Body>
 * </Slidewise.Root>
 * ```
 *
 * Use `<Slidewise.Root>` directly when you need to wrap, replace, or omit
 * any region.
 */
export const SlidewiseEditor = forwardRef<
  SlidewiseEditorHandle,
  SlidewiseEditorProps
>(function SlidewiseEditor(
  {
    deck,
    onChange,
    onSave,
    onExport,
    onDirtyChange,
    onHistoryChange,
    readOnly,
    theme,
    initialSlideId,
    showTopBar = true,
    showBottomToolbar = true,
    fontFamily,
    icons,
    className,
    style,
  },
  ref
) {
  const rootProps: SlidewiseRootProps = {
    deck,
    onChange,
    onSave,
    onExport,
    onDirtyChange,
    onHistoryChange,
    readOnly,
    theme,
    initialSlideId,
    fontFamily,
    icons,
    className,
    style,
  };

  return (
    <Root {...rootProps} ref={ref}>
      {showTopBar && <TopBar />}
      <Body>
        <SlideRail />
        <CanvasFrame>
          <Canvas />
          {showBottomToolbar && <BottomToolbar />}
        </CanvasFrame>
      </Body>
    </Root>
  );
});

export default SlidewiseEditor;
