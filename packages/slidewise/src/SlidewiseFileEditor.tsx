import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { SlidewiseEditor, type SlidewiseEditorHandle } from "./SlidewiseEditor";
import { parsePptx, serializeDeck } from "@/lib/pptx";
import type { Deck } from "@/lib/types";
import type { SlidewiseIcons } from "./compound/IconContext";
import type { SlidewiseLabels } from "./compound/LabelsContext";
import type { SlidewiseSurfaces } from "./compound/SurfacesContext";
import type { SlidewiseCanvasConfig } from "./compound/CanvasContext";
import { DEFAULT_LABELS } from "./compound/LabelsContext";
import type { Transition } from "framer-motion";
import type { HistoryState, SelectionSnapshot } from "./compound/SlidewiseRoot";

export interface SlidewiseFileEditorProps {
  /**
   * Async loader for the file's bytes. Host is responsible for fetching the
   * blob (e.g. via the platform's `getFile(fileId, { preview: true })`).
   * Called once on mount.
   */
  loadBlob: () => Promise<Blob | ArrayBuffer>;
  /**
   * Async saver for a serialized PPTX blob. Host is responsible for the
   * upload and conflict handling (e.g. via `saveFileContent(fileId, …)`).
   * Called when `save()` is invoked on the imperative API.
   */
  saveBlob: (blob: Blob) => Promise<void>;
  /**
   * When `false`, the top bar's save / undo / redo buttons are hidden and
   * the title input is read-only. Mirrors the host's "viewer doesn't have
   * write access" state. Defaults to `true`.
   */
  editable?: boolean;
  /**
   * The sha256 of the file's contents at load time, if the host wants to do
   * conflict detection. Stored verbatim and surfaced via `getInitialSha256()`
   * — Slidewise itself doesn't read it; the host's saveBlob implementation does.
   */
  initialSha256?: string | null;
  /**
   * Receives an imperative API for save / dirty-tracking / play once the
   * editor is mounted. Called with `null` on unmount.
   */
  onEditorApiChange?: (api: SlidewiseFileEditorApi | null) => void;
  /** Fires after every committed mutation. Mirrors `SlidewiseEditor.onChange`. */
  onChange?: (deck: Deck) => void;
  /**
   * Fires reactively when the dirty flag flips. Use this instead of polling
   * `api.isDirty()` for "unsaved changes" UI.
   */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Fires whenever the undo/redo stack depths change. Use this to enable/
   * disable host-rendered Undo/Redo buttons reactively without polling
   * `api.canUndo()` / `api.canRedo()`.
   */
  onHistoryChange?: (state: HistoryState) => void;
  /** Fires when the active slide changes (user click, programmatic goToSlide). */
  onActiveSlideChange?: (slideId: string) => void;
  /** Fires when the selected element ids change. */
  onSelectionChange?: (selection: SelectionSnapshot) => void;
  /** Fires when the canvas zoom level changes. */
  onZoomChange?: (scale: number) => void;
  /** Fires immediately before the host's `saveBlob` is invoked. */
  onSaveStart?: () => void;
  /** Fires after `saveBlob` resolves successfully. */
  onSaveSuccess?: () => void;
  /** Fires when `saveBlob` throws. The error still propagates. */
  onSaveError?: (err: Error) => void;
  /**
   * Fires when `loadBlob` or `parse` throws on mount. The default render
   * still shows an in-editor "Could not open file" message, but hosts that
   * want to surface their own error UI can replace it via this callback.
   */
  onLoadError?: (err: Error) => void;
  theme?: "light" | "dark";
  /** Slide id to land on; falls back to the first. */
  initialSlideId?: string;
  /** Render the built-in top bar. Default `true`. */
  showTopBar?: boolean;
  /** Render the floating bottom toolbar. Default `true` in edit, `false` in preview. */
  showBottomToolbar?: boolean;
  /**
   * High-level chrome preset. `"preview"` hides the bottom toolbar and the
   * add-slide button and trims the top bar to title + play. Defaults to
   * `"edit"`. See `SlidewiseEditorProps.mode`.
   */
  mode?: "edit" | "preview";
  /** Hide the "New Slide" button at the bottom of the side rail. */
  hideAddButton?: boolean;
  /** Hide slide-number badges on side-rail thumbnails. */
  hideSlideNumbers?: boolean;
  /** Hide the leading "Smart" pill in the top bar title. */
  hideSmart?: boolean;
  /**
   * Override the bundled Geist font; sets `--font-geist-sans` on the editor
   * root.
   */
  fontFamily?: string;
  /**
   * Per-action icon overrides. Pass a ReactNode for any of `undo`, `redo`,
   * `save`, `play`, `themeLight`, `themeDark`, `export`, `smart` to skin the
   * editor's chrome with your own icon set.
   */
  icons?: SlidewiseIcons;
  /**
   * User-visible string overrides for i18n. Pass any subset; missing
   * entries fall back to English defaults. The "Unsaved changes" badge
   * and the loading / load-error messages also key off this table.
   */
  labels?: SlidewiseLabels;
  /**
   * Per-surface background overrides; equivalent to setting the
   * `--slidewise-bg-*` CSS variables.
   */
  surfaces?: SlidewiseSurfaces;
  /**
   * Canvas/viewport configuration: padding, initial zoom, slide shadow +
   * radius, and host-driven slide-background overrides.
   */
  canvas?: SlidewiseCanvasConfig;
  /**
   * Reduced-motion behavior. `"system"` (default) respects the OS
   * preference; `true` forces motion off; `false` forces it on.
   */
  reduceMotion?: boolean | "system";
  /** Default framer-motion transition applied via `<MotionConfig>`. */
  transition?: Transition;
  className?: string;
  style?: CSSProperties;
  /**
   * Optional override for how the file is parsed. Default uses Slidewise's
   * built-in PPTX parser. Useful for testing or for hosting a different
   * binary deck format on top of the editor.
   */
  parse?: (blob: Blob | ArrayBuffer) => Promise<Deck>;
  /**
   * Optional override for how the file is serialized. Default uses
   * Slidewise's built-in PPTX writer.
   */
  serialize?: (deck: Deck) => Promise<Blob>;
}

export interface SlidewiseFileEditorApi {
  save(): Promise<void>;
  isDirty(): boolean;
  play(): void;
  stop(): void;
  undo(): void;
  redo(): void;
  /** True iff there's at least one snapshot to undo back to. */
  canUndo(): boolean;
  /** True iff there's at least one snapshot to redo forward to. */
  canRedo(): boolean;
  /** Current undo/redo stack depths. */
  getHistorySize(): { undo: number; redo: number };
  /**
   * End the in-flight coalesce burst. Call on natural commit boundaries
   * (mouseup after drag, blur on a text input) so the next mutation starts
   * a fresh history step. Most hosts won't need this — a 500ms idle window
   * handles typical typing/drag bursts automatically.
   */
  endCoalesce(): void;

  /** Switch the active slide. No-op when `slideId` is not in the deck. */
  goToSlide(slideId: string): void;
  /** Advance to the next slide. No-op past the last slide. */
  nextSlide(): void;
  /** Step back to the previous slide. No-op past the first. */
  prevSlide(): void;

  /** Zoom out by one step. */
  zoomOut(): void;
  /** Zoom in by one step. */
  zoomIn(): void;
  /** Set absolute zoom (1 = 100%); clamped to [0.1, 4]. */
  setZoom(scale: number): void;

  /**
   * Insert a blank slide after `afterId`, or at the end. Returns the new
   * slide's id. The new slide becomes active.
   */
  addSlide(afterId?: string): string | null;
  /**
   * Duplicate `slideId`. Returns the new slide's id, or `null` if not
   * found. The duplicate becomes active.
   */
  duplicateSlide(slideId: string): string | null;
  /** Delete `slideId`. No-op when the deck would be left empty. */
  deleteSlide(slideId: string): void;

  /** Current selection snapshot (slide id + selected element ids). */
  getSelection(): SelectionSnapshot;

  /** Live deck snapshot. Hosts use this for header badges (slide count, etc.). */
  getDeck(): Deck | null;
  getInitialSha256(): string | null;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; deck: Deck };

export const SlidewiseFileEditor = forwardRef<
  SlidewiseFileEditorApi,
  SlidewiseFileEditorProps
>(function SlidewiseFileEditor(
  {
    loadBlob,
    saveBlob,
    editable = true,
    initialSha256 = null,
    onEditorApiChange,
    onChange,
    onDirtyChange,
    onLoadError,
    onHistoryChange,
    onActiveSlideChange,
    onSelectionChange,
    onZoomChange,
    onSaveStart,
    onSaveSuccess,
    onSaveError,
    theme,
    initialSlideId,
    showTopBar,
    showBottomToolbar,
    mode,
    hideAddButton,
    hideSlideNumbers,
    hideSmart,
    fontFamily,
    icons,
    labels,
    surfaces,
    canvas,
    reduceMotion,
    transition,
    className,
    style,
    parse = parsePptx,
    serialize = serializeDeck,
  },
  ref
) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const editorRef = useRef<SlidewiseEditorHandle>(null);
  const [dirty, setDirty] = useState(false);
  const apiCallbackRef = useRef(onEditorApiChange);
  const onChangeRef = useRef(onChange);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onLoadErrorRef = useRef(onLoadError);

  useEffect(() => {
    apiCallbackRef.current = onEditorApiChange;
    onChangeRef.current = onChange;
    onDirtyChangeRef.current = onDirtyChange;
    onLoadErrorRef.current = onLoadError;
  }, [onEditorApiChange, onChange, onDirtyChange, onLoadError]);

  // Load file once on mount.
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const blob = await loadBlob();
        const deck = await parse(blob);
        if (!cancelled) setState({ status: "ready", deck });
      } catch (err) {
        if (cancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ status: "error", error });
        onLoadErrorRef.current?.(error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // loadBlob/parse intentionally omitted: we load exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build and publish the imperative API. Republish whenever inputs change
  // so closures see the latest serialize/saveBlob.
  useEffect(() => {
    if (state.status !== "ready") return;

    const api: SlidewiseFileEditorApi = {
      save: async () => {
        const current = editorRef.current?.getDeck() ?? state.deck;
        const blob = await serialize(current);
        await saveBlob(blob);
        editorRef.current?.resetDirty();
      },
      isDirty: () => editorRef.current?.isDirty() ?? false,
      play: () => editorRef.current?.play(),
      stop: () => editorRef.current?.stop(),
      undo: () => editorRef.current?.undo(),
      redo: () => editorRef.current?.redo(),
      canUndo: () => editorRef.current?.canUndo() ?? false,
      canRedo: () => editorRef.current?.canRedo() ?? false,
      getHistorySize: () =>
        editorRef.current?.getHistorySize() ?? { undo: 0, redo: 0 },
      endCoalesce: () => editorRef.current?.endCoalesce(),
      goToSlide: (slideId: string) => editorRef.current?.goToSlide(slideId),
      nextSlide: () => editorRef.current?.nextSlide(),
      prevSlide: () => editorRef.current?.prevSlide(),
      zoomIn: () => editorRef.current?.zoomIn(),
      zoomOut: () => editorRef.current?.zoomOut(),
      setZoom: (scale: number) => editorRef.current?.setZoom(scale),
      addSlide: (afterId?: string) =>
        editorRef.current?.addSlide(afterId) ?? null,
      duplicateSlide: (slideId: string) =>
        editorRef.current?.duplicateSlide(slideId) ?? null,
      deleteSlide: (slideId: string) =>
        editorRef.current?.deleteSlide(slideId),
      getSelection: () =>
        editorRef.current?.getSelection() ?? {
          slideId: state.deck.slides[0]?.id ?? "",
          elementIds: [],
        },
      getDeck: () => editorRef.current?.getDeck() ?? state.deck,
      getInitialSha256: () => initialSha256,
    };

    apiCallbackRef.current?.(api);
    return () => {
      apiCallbackRef.current?.(null);
    };
  }, [state, serialize, saveBlob, initialSha256]);

  useImperativeHandle(
    ref,
    () => ({
      save: async () => {
        if (state.status !== "ready") return;
        const current = editorRef.current?.getDeck() ?? state.deck;
        const blob = await serialize(current);
        await saveBlob(blob);
        editorRef.current?.resetDirty();
      },
      isDirty: () => editorRef.current?.isDirty() ?? false,
      play: () => editorRef.current?.play(),
      stop: () => editorRef.current?.stop(),
      undo: () => editorRef.current?.undo(),
      redo: () => editorRef.current?.redo(),
      canUndo: () => editorRef.current?.canUndo() ?? false,
      canRedo: () => editorRef.current?.canRedo() ?? false,
      getHistorySize: () =>
        editorRef.current?.getHistorySize() ?? { undo: 0, redo: 0 },
      endCoalesce: () => editorRef.current?.endCoalesce(),
      goToSlide: (slideId: string) => editorRef.current?.goToSlide(slideId),
      nextSlide: () => editorRef.current?.nextSlide(),
      prevSlide: () => editorRef.current?.prevSlide(),
      zoomIn: () => editorRef.current?.zoomIn(),
      zoomOut: () => editorRef.current?.zoomOut(),
      setZoom: (scale: number) => editorRef.current?.setZoom(scale),
      addSlide: (afterId?: string) =>
        editorRef.current?.addSlide(afterId) ?? null,
      duplicateSlide: (slideId: string) =>
        editorRef.current?.duplicateSlide(slideId) ?? null,
      deleteSlide: (slideId: string) =>
        editorRef.current?.deleteSlide(slideId),
      getSelection: () =>
        editorRef.current?.getSelection() ?? {
          slideId:
            state.status === "ready" ? state.deck.slides[0]?.id ?? "" : "",
          elementIds: [],
        },
      getDeck: () =>
        state.status === "ready"
          ? editorRef.current?.getDeck() ?? state.deck
          : null,
      getInitialSha256: () => initialSha256,
    }),
    [state, serialize, saveBlob, initialSha256]
  );

  if (state.status === "loading") {
    return (
      <div style={{ ...frameStyle, ...style }} className={className}>
        <div style={messageStyle}>
          {labels?.fileLoading ?? DEFAULT_LABELS.fileLoading}
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    const fmt = labels?.fileLoadError ?? DEFAULT_LABELS.fileLoadError;
    return (
      <div style={{ ...frameStyle, ...style }} className={className}>
        <div style={{ ...messageStyle, color: "#E8504C" }}>
          {fmt(state.error.message)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...frameStyle, ...style }} className={className}>
      <SlidewiseEditor
        ref={editorRef}
        deck={state.deck}
        theme={theme}
        readOnly={!editable}
        initialSlideId={initialSlideId}
        showTopBar={showTopBar}
        showBottomToolbar={showBottomToolbar}
        mode={mode}
        hideAddButton={hideAddButton}
        hideSlideNumbers={hideSlideNumbers}
        hideSmart={hideSmart}
        fontFamily={fontFamily}
        icons={icons}
        labels={labels}
        surfaces={surfaces}
        canvas={canvas}
        reduceMotion={reduceMotion}
        transition={transition}
        onChange={(next) => {
          onChangeRef.current?.(next);
        }}
        onDirtyChange={(d) => {
          setDirty(d);
          onDirtyChangeRef.current?.(d);
        }}
        onHistoryChange={onHistoryChange}
        onActiveSlideChange={onActiveSlideChange}
        onSelectionChange={onSelectionChange}
        onZoomChange={onZoomChange}
        onSaveStart={onSaveStart}
        onSaveSuccess={onSaveSuccess}
        onSaveError={onSaveError}
        onSave={async (next) => {
          const blob = await serialize(next);
          await saveBlob(blob);
        }}
      />
      {dirty && (
        <UnsavedBadge
          label={labels?.unsavedBadge ?? DEFAULT_LABELS.unsavedBadge}
        />
      )}
    </div>
  );
});

const frameStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  position: "relative",
  display: "flex",
  flexDirection: "column",
  background: "#ffffff",
};

const messageStyle: CSSProperties = {
  margin: "auto",
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 14,
  color: "#5b6178",
};

function UnsavedBadge({ label }: { label: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        padding: "4px 10px",
        background:
          "var(--slidewise-bg-unsaved-badge, rgba(232, 80, 76, 0.12))",
        color: "#E8504C",
        borderRadius: 999,
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.2,
        zIndex: 50,
        pointerEvents: "none",
      }}
    >
      {label}
    </div>
  );
}

export default SlidewiseFileEditor;
