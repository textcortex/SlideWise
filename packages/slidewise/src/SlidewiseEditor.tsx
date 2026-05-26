import { forwardRef, type CSSProperties } from "react";
import {
  Root,
  type SlidewiseRootHandle,
  type SlidewiseRootProps,
  type HistoryState,
  type SelectionSnapshot,
} from "./compound/SlidewiseRoot";
import { TopBar } from "./compound/topbar";
import { SlideRail } from "./compound/sliderail";
import {
  Canvas,
  BottomToolbar,
  Body,
  CanvasFrame,
} from "./compound/parts";
import type { SlidewiseIcons } from "./compound/IconContext";
import type { SlidewiseLabels } from "./compound/LabelsContext";
import type { SlidewiseSurfaces } from "./compound/SurfacesContext";
import type { SlidewiseCanvasConfig } from "./compound/CanvasContext";
import type { Transition } from "framer-motion";
import type { Deck, WebFontAsset } from "@/lib/types";
import "./SlidewiseEditor.css";

export interface SlidewiseEditorProps {
  /**
   * The deck to edit. Loaded into the editor on mount. If a different
   * Deck reference is later passed, the editor's internal state is reset
   * to it (dirty flag reset). Do NOT pass a new reference on every
   * `onChange` — that would loop. Hold the deck in a stable ref, and
   * only pass a new one when you intentionally want to reset the editor
   * (e.g. discard changes, load a different file).
   *
   * One of `deck` or `jsonDeck` is required.
   */
  deck?: Deck;
  /**
   * Deck supplied as JSON — either a `Deck` object or a JSON string. This
   * is the AI-facing entry point: feed model output directly without
   * manually calling `JSON.parse` or `migrate()`. The value is parsed (if
   * a string) and run through `migrate()` so older schema versions are
   * upgraded transparently.
   *
   * Takes precedence over `deck` when both are provided. Pass a stable
   * reference (or stable string) on subsequent renders — changing it
   * resets the editor's internal state, same as swapping `deck`.
   *
   * The JSON shape is the public `Deck` type exported from this package.
   * Use it as the schema your LLM targets when generating new decks.
   */
  jsonDeck?: Deck | string;
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
  /** Fires when the active slide changes (user click, programmatic goToSlide). */
  onActiveSlideChange?: (slideId: string) => void;
  /** Fires when the selected element ids change. */
  onSelectionChange?: (selection: SelectionSnapshot) => void;
  /** Fires when the canvas zoom level changes. */
  onZoomChange?: (scale: number) => void;
  /** Fires immediately before the host's `onSave` is invoked. */
  onSaveStart?: () => void;
  /** Fires after the host's `onSave` resolves successfully. */
  onSaveSuccess?: () => void;
  /** Fires when the host's `onSave` throws. The error still propagates. */
  onSaveError?: (err: Error) => void;
  /** Reserved for future use; not enforced yet. */
  readOnly?: boolean;
  /**
   * High-level preset for the editor chrome. Defaults to `"edit"`.
   *
   * - `"edit"` — full editor: top bar, side rail with add-slide button +
   *   slide numbers, bottom tool selector.
   * - `"preview"` — read-only chrome: hides the bottom tool selector and
   *   the add-slide button, sets `readOnly`, and trims the top bar to
   *   just the title and play button. Per-flag props below still win
   *   when explicitly set, so hosts can layer on top of the preset
   *   (e.g. `mode="preview" showBottomToolbar`).
   *
   * Canvas-level edit prevention (selection, drag, text editing) is
   * not yet wired to `readOnly`; today the preset only changes the
   * editor chrome.
   */
  mode?: "edit" | "preview";
  /** "light" or "dark"; defaults to "light". Ignored after first render. */
  theme?: "light" | "dark";
  /** Slide id to land on; falls back to the first slide. */
  initialSlideId?: string;
  /** Render the built-in top bar (title, undo/redo, save, play). Default true. */
  showTopBar?: boolean;
  /** Render the floating bottom toolbar (tool selector). Default true in edit, false in preview. */
  showBottomToolbar?: boolean;
  /** Hide the "New Slide" button at the bottom of the side rail. Default false in edit, true in preview. */
  hideAddButton?: boolean;
  /** Hide the slide-number badges on side-rail thumbnails. Default false. */
  hideSlideNumbers?: boolean;
  /** Hide the leading "Smart" pill in the top bar title. Default false in edit, true in preview. */
  hideSmart?: boolean;
  /** Override the bundled Geist font; sets `--font-geist-sans` on the root. */
  fontFamily?: string;
  /**
   * Reduced-motion behavior. `"system"` (default) respects the OS
   * preference; `true` forces motion off; `false` forces it on.
   */
  reduceMotion?: boolean | "system";
  /**
   * Default framer-motion transition applied via `<MotionConfig>`. Use
   * this to retune the editor's animation feel globally.
   */
  transition?: Transition;
  /**
   * Per-action icon overrides. Pass a ReactNode for any of `undo`, `redo`,
   * `save`, `play`, `themeLight`, `themeDark`, `export`, `smart` to skin the
   * editor's chrome with your own icon set; missing slots fall back to the
   * bundled lucide-react icons.
   */
  icons?: SlidewiseIcons;
  /**
   * User-visible string overrides for i18n. Pass any subset; missing
   * entries fall back to English defaults.
   */
  labels?: SlidewiseLabels;
  /**
   * Per-surface background overrides, equivalent to setting the
   * `--slidewise-bg-*` CSS variables. See `SlidewiseSurfaces` for the full
   * list of keys.
   */
  surfaces?: SlidewiseSurfaces;
  /**
   * Canvas/viewport configuration: padding, initial zoom, slide shadow +
   * radius, and host-driven slide-background overrides. Use this when the
   * default "slide fills the workspace" presentation isn't right for your
   * host chrome.
   */
  canvas?: SlidewiseCanvasConfig;
  /**
   * Per-host web font registry. The editor injects `@font-face` rules so
   * the canvas renders text in your brand typeface. Per-deck entries on
   * `Deck.webFonts` override on family-name collisions. Has no effect on
   * PPTX export — that path uses `Deck.fonts` (the embedded payload).
   */
  fontRegistry?: WebFontAsset[];
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
    jsonDeck,
    onChange,
    onSave,
    onExport,
    onDirtyChange,
    onHistoryChange,
    onActiveSlideChange,
    onSelectionChange,
    onZoomChange,
    onSaveStart,
    onSaveSuccess,
    onSaveError,
    readOnly,
    mode = "edit",
    theme,
    initialSlideId,
    showTopBar = true,
    showBottomToolbar,
    hideAddButton,
    hideSlideNumbers,
    hideSmart,
    fontFamily,
    reduceMotion,
    transition,
    icons,
    labels,
    surfaces,
    canvas,
    fontRegistry,
    className,
    style,
  },
  ref
) {
  const isPreview = mode === "preview";
  const effectiveReadOnly = readOnly ?? isPreview;
  const effectiveShowBottomToolbar = showBottomToolbar ?? !isPreview;
  const effectiveHideAddButton = hideAddButton ?? isPreview;
  const effectiveHideSmart = hideSmart ?? isPreview;

  const rootProps: SlidewiseRootProps = {
    deck,
    jsonDeck,
    onChange,
    onSave,
    onExport,
    onDirtyChange,
    onHistoryChange,
    onActiveSlideChange,
    onSelectionChange,
    onZoomChange,
    onSaveStart,
    onSaveSuccess,
    onSaveError,
    readOnly: effectiveReadOnly,
    theme,
    initialSlideId,
    fontFamily,
    reduceMotion,
    transition,
    icons,
    labels,
    surfaces,
    canvas,
    fontRegistry,
    className,
    style,
  };

  return (
    <Root {...rootProps} ref={ref}>
      {showTopBar && (
        <TopBar
          hide={isPreview ? ["themeToggle", "export"] : undefined}
          hideSmart={effectiveHideSmart}
        />
      )}
      <Body>
        <SlideRail
          hideAddButton={effectiveHideAddButton}
          hideNumbers={hideSlideNumbers}
        />
        <CanvasFrame>
          <Canvas />
          {effectiveShowBottomToolbar && <BottomToolbar />}
        </CanvasFrame>
      </Body>
    </Root>
  );
});

export default SlidewiseEditor;
