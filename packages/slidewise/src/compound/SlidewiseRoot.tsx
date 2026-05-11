import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type PropsWithChildren,
  type Ref,
} from "react";
import {
  EditorStoreProvider,
  useEditor,
  useEditorStore,
} from "@/lib/StoreProvider";
import { collectFontFamilies, ensureGoogleFontsLoaded } from "@/lib/fonts";
import type { Deck } from "@/lib/types";
import { GridView } from "@/components/editor/GridView";
import { PlayMode } from "@/components/editor/PlayMode";
import { MotionConfig, type Transition } from "framer-motion";
import { HostProvider } from "./HostContext";
import { IconProvider, type SlidewiseIcons } from "./IconContext";
import { ReadOnlyProvider } from "./ReadOnlyContext";
import { DirtyProvider } from "./DirtyContext";
import { LabelsProvider, type SlidewiseLabels } from "./LabelsContext";
import {
  SurfacesProvider,
  surfacesToCssVars,
  type SlidewiseSurfaces,
} from "./SurfacesContext";
import {
  CanvasConfigProvider,
  type SlidewiseCanvasConfig,
} from "./CanvasContext";

export interface SlidewiseRootProps {
  /**
   * Deck to load on mount. Pass a new reference only when you intend to
   * reset the editor's state (e.g. discard changes, load a different file)
   * — passing a new reference on every `onChange` would loop.
   */
  deck: Deck;
  /** Fires after every committed mutation. */
  onChange?: (deck: Deck) => void;
  /** Fires when the user invokes save (top bar button or imperative API). */
  onSave?: (deck: Deck) => void | Promise<void>;
  /** Override the default `.slidewise.json` export. */
  onExport?: (deck: Deck) => void;
  /** Fires when the dirty flag flips. */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Fires whenever the undo/redo stacks change depth. Use this to update
   * "Undo"/"Redo" button enabled state without polling `canUndo()`/`canRedo()`.
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
  /**
   * Hide editing affordances (save / undo / redo) and disable canvas
   * mutations. Use this when the host viewer doesn't have write access.
   */
  readOnly?: boolean;
  /** "light" | "dark"; first-render only. */
  theme?: "light" | "dark";
  /** Slide id to land on; falls back to the first. */
  initialSlideId?: string;
  /** Override the default Geist font; sets `--slidewise-font-sans`. */
  fontFamily?: string;
  /**
   * Controls reduced-motion behavior.
   *
   * - `"system"` (default) — respect the user's OS preference via the
   *   `prefers-reduced-motion` media query.
   * - `true` — force all CSS animations + transitions off and tell
   *   framer-motion to skip motion. Use for hosts whose own product
   *   already has a global motion-off toggle.
   * - `false` — force motion on even when the OS reports reduced-motion.
   *   Useful for previewing animations during development; not generally
   *   recommended in production since it overrides an accessibility hint.
   */
  reduceMotion?: boolean | "system";
  /**
   * Default framer-motion transition. Passed through to a wrapping
   * `<MotionConfig>` so every motion component inside the editor inherits
   * it. Useful for retuning the editor's overall feel (faster, springier,
   * etc.) without touching individual components.
   *
   * For CSS transitions, override the duration/easing tokens instead —
   * `--slidewise-duration-base`, `--slidewise-easing-standard`, etc.
   */
  transition?: Transition;
  /**
   * Per-action icon overrides for the chrome. Hosts pass any subset to
   * skin Slidewise with their own icon set; missing slots fall back to
   * the bundled lucide icons.
   */
  icons?: SlidewiseIcons;
  /**
   * User-visible string overrides for i18n. Pass any subset; missing
   * entries fall back to English defaults. Pairs with `icons` for full
   * locale customization.
   */
  labels?: SlidewiseLabels;
  /**
   * Per-surface background overrides. Equivalent to setting the
   * `--slidewise-bg-*` CSS variables on the root, but as a typed prop so
   * hosts can drive theming from JS without writing CSS:
   *
   * ```tsx
   * <Slidewise.Root surfaces={{ app: "#0b0d10", rail: "#1c1c22" }}>
   * ```
   */
  surfaces?: SlidewiseSurfaces;
  /**
   * Canvas/viewport configuration. Set `padding`, `slideRadius`,
   * `slideShadow`, and an initial `defaultZoom` to keep the slide
   * presented as a centered card rather than letting a bold deck fill
   * paint the entire workspace. `forceSlideBackground` /
   * `resolveSlideBackground` let hosts override per-slide fills.
   */
  canvas?: SlidewiseCanvasConfig;
  /** Extra class names appended to the root. */
  className?: string;
  /** Inline style applied to the root. */
  style?: CSSProperties;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  /** Snapshot counts. Useful for "X steps to redo" indicators. */
  undoSize: number;
  redoSize: number;
}

/** Snapshot of the current selection, scoped to the active slide. */
export interface SelectionSnapshot {
  slideId: string;
  elementIds: string[];
}

export interface SlidewiseRootHandle {
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
   * a fresh history step. Most hosts won't need this — the 500ms idle
   * window handles typical typing/drag bursts.
   */
  endCoalesce(): void;

  // ---- Navigation ----
  /** Switch the active slide. No-op when `slideId` is not in the deck. */
  goToSlide(slideId: string): void;
  /** Advance to the slide after the current one. No-op past the last slide. */
  nextSlide(): void;
  /** Step back to the slide before the current one. No-op past the first. */
  prevSlide(): void;

  // ---- Zoom ----
  /** Zoom out by one step (×0.8), clamped to the editor's min zoom. */
  zoomOut(): void;
  /** Zoom in by one step (×1.25), clamped to the editor's max zoom. */
  zoomIn(): void;
  /** Set the absolute zoom (1 = 100%); clamped to [0.1, 4]. */
  setZoom(scale: number): void;

  // ---- Slide CRUD ----
  /**
   * Insert a blank slide after `afterId`, or at the end if `afterId` is
   * omitted. Returns the new slide's id. The new slide becomes active.
   */
  addSlide(afterId?: string): string;
  /**
   * Insert a copy of `slideId` immediately after it. Returns the new
   * slide's id, or `null` if `slideId` wasn't found. The copy becomes
   * active.
   */
  duplicateSlide(slideId: string): string | null;
  /**
   * Delete a slide. No-op when the deck would be left with zero slides.
   */
  deleteSlide(slideId: string): void;

  // ---- Selection ----
  /** Current selection snapshot (slide id + selected element ids). */
  getSelection(): SelectionSnapshot;

  getDeck(): Deck;
  isDirty(): boolean;
  resetDirty(): void;
}

/**
 * Top-level compound part. Provides the editor's store via context to all
 * descendants and renders the themed root container. Compose any subset of
 * `<Slidewise.TopBar />`, `<Slidewise.SlideRail />`, `<Slidewise.Canvas />`,
 * `<Slidewise.RightPanel />`, `<Slidewise.BottomToolbar />` as children — or
 * mix them with host UI to wrap, replace, or omit any region.
 *
 * Hosts that want the unopinionated default tree can use `<SlidewiseEditor>`
 * which is just `<Slidewise.Root>` rendering the standard layout.
 */
export const Root = forwardRef<SlidewiseRootHandle, PropsWithChildren<SlidewiseRootProps>>(
  function SlidewiseRoot(props, ref) {
    return (
      <EditorStoreProvider initialDeck={props.deck}>
        <RootInner {...props} forwardedRef={ref} />
      </EditorStoreProvider>
    );
  }
);

function RootInner({
  deck,
  onChange,
  onSave,
  onExport,
  onDirtyChange,
  onHistoryChange: props_onHistoryChange,
  onActiveSlideChange,
  onSelectionChange,
  onZoomChange,
  onSaveStart,
  onSaveSuccess,
  onSaveError,
  readOnly = false,
  theme,
  initialSlideId,
  fontFamily,
  reduceMotion = "system",
  transition,
  icons,
  labels,
  surfaces,
  canvas,
  className,
  style,
  children,
  forwardedRef,
}: PropsWithChildren<SlidewiseRootProps> & {
  forwardedRef: Ref<SlidewiseRootHandle>;
}) {
  const store = useEditorStore();
  const savedDeckRef = useRef<Deck>(deck);
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const onChangeRef = useRef(onChange);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onSaveRef = useRef(onSave);
  const onExportRef = useRef(onExport);
  const onHistoryChangeRef = useRef(props_onHistoryChange);
  const onActiveSlideChangeRef = useRef(onActiveSlideChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onZoomChangeRef = useRef(onZoomChange);
  const onSaveStartRef = useRef(onSaveStart);
  const onSaveSuccessRef = useRef(onSaveSuccess);
  const onSaveErrorRef = useRef(onSaveError);

  useEffect(() => {
    onChangeRef.current = onChange;
    onDirtyChangeRef.current = onDirtyChange;
    onSaveRef.current = onSave;
    onExportRef.current = onExport;
    onHistoryChangeRef.current = props_onHistoryChange;
    onActiveSlideChangeRef.current = onActiveSlideChange;
    onSelectionChangeRef.current = onSelectionChange;
    onZoomChangeRef.current = onZoomChange;
    onSaveStartRef.current = onSaveStart;
    onSaveSuccessRef.current = onSaveSuccess;
    onSaveErrorRef.current = onSaveError;
  }, [
    onChange,
    onDirtyChange,
    onSave,
    onExport,
    props_onHistoryChange,
    onActiveSlideChange,
    onSelectionChange,
    onZoomChange,
    onSaveStart,
    onSaveSuccess,
    onSaveError,
  ]);

  useEffect(() => {
    if (theme) {
      store.getState().setTheme(theme);
    }
  }, [theme, store]);

  useEffect(() => {
    if (initialSlideId) {
      const exists = store
        .getState()
        .deck.slides.some((s) => s.id === initialSlideId);
      if (exists) {
        store.getState().selectSlide(initialSlideId);
      }
    }
    // Apply canvas defaults once on mount. setZoom auto-flips fitMode to
    // "manual" so we set fitMode last to honor an explicit canvas.fitMode.
    if (canvas?.defaultZoom !== undefined) {
      store.getState().setZoom(canvas.defaultZoom);
    }
    if (canvas?.fitMode) {
      store.getState().setFitMode(canvas.fitMode);
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (deck !== savedDeckRef.current) {
      store.getState().setDeck(deck);
      savedDeckRef.current = deck;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setDirty(false);
        onDirtyChangeRef.current?.(false);
      }
    }
  }, [deck, store]);

  const instanceId = useId().replace(/[^a-z0-9]/gi, "");
  useEffect(() => {
    ensureGoogleFontsLoaded(
      instanceId,
      collectFontFamilies(store.getState().deck)
    );
    return store.subscribe((state, prev) => {
      // Fire onHistoryChange whenever stack depths change. Independent of
      // deck identity so undo/redo always emit, even if the resulting deck
      // happens to be reference-equal (shouldn't, but defensive).
      const prevHist = prev.history.length;
      const prevFut = prev.future.length;
      const nextHist = state.history.length;
      const nextFut = state.future.length;
      if (prevHist !== nextHist || prevFut !== nextFut) {
        onHistoryChangeRef.current?.({
          canUndo: nextHist > 0,
          canRedo: nextFut > 0,
          undoSize: nextHist,
          redoSize: nextFut,
        });
      }

      // Active slide changes (click in rail, programmatic goToSlide).
      if (state.currentSlideId !== prev.currentSlideId) {
        onActiveSlideChangeRef.current?.(state.currentSlideId);
      }

      // Selection — shallow compare ids since the array is rebuilt on
      // every selectElement call. Same slideId + same ids = no emit.
      if (
        state.selectedIds !== prev.selectedIds &&
        !shallowEqualIds(state.selectedIds, prev.selectedIds)
      ) {
        onSelectionChangeRef.current?.({
          slideId: state.currentSlideId,
          elementIds: state.selectedIds,
        });
      }

      // Zoom.
      if (state.zoom !== prev.zoom) {
        onZoomChangeRef.current?.(state.zoom);
      }

      if (state.deck === prev.deck) return;
      onChangeRef.current?.(state.deck);
      const nextDirty = state.deck !== savedDeckRef.current;
      if (nextDirty !== dirtyRef.current) {
        dirtyRef.current = nextDirty;
        setDirty(nextDirty);
        onDirtyChangeRef.current?.(nextDirty);
      }
      ensureGoogleFontsLoaded(instanceId, collectFontFamilies(state.deck));
    });
  }, [store, instanceId]);

  useEffect(() => {
    return () => {
      ensureGoogleFontsLoaded(instanceId, []);
    };
  }, [instanceId]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      play: () => store.getState().play(),
      stop: () => store.getState().stop(),
      undo: () => store.getState().undo(),
      redo: () => store.getState().redo(),
      canUndo: () => store.getState().canUndo(),
      canRedo: () => store.getState().canRedo(),
      getHistorySize: () => {
        const s = store.getState();
        return { undo: s.history.length, redo: s.future.length };
      },
      endCoalesce: () => store.getState().endCoalesce(),

      goToSlide: (slideId: string) => {
        const s = store.getState();
        if (s.deck.slides.some((sl) => sl.id === slideId)) {
          s.selectSlide(slideId);
        }
      },
      nextSlide: () => {
        const s = store.getState();
        const idx = s.deck.slides.findIndex(
          (sl) => sl.id === s.currentSlideId
        );
        const next = s.deck.slides[idx + 1];
        if (next) s.selectSlide(next.id);
      },
      prevSlide: () => {
        const s = store.getState();
        const idx = s.deck.slides.findIndex(
          (sl) => sl.id === s.currentSlideId
        );
        const prev = s.deck.slides[idx - 1];
        if (prev) s.selectSlide(prev.id);
      },

      zoomIn: () => store.getState().zoomIn(),
      zoomOut: () => store.getState().zoomOut(),
      setZoom: (scale: number) => store.getState().setZoom(scale),

      addSlide: (afterId?: string) => store.getState().addSlide(afterId),
      duplicateSlide: (slideId: string) =>
        store.getState().duplicateSlide(slideId),
      deleteSlide: (slideId: string) => store.getState().deleteSlide(slideId),

      getSelection: (): SelectionSnapshot => {
        const s = store.getState();
        return {
          slideId: s.currentSlideId,
          elementIds: [...s.selectedIds],
        };
      },

      getDeck: () => store.getState().deck,
      isDirty: () => dirtyRef.current,
      resetDirty: () => {
        savedDeckRef.current = store.getState().deck;
        if (dirtyRef.current) {
          dirtyRef.current = false;
          setDirty(false);
          onDirtyChangeRef.current?.(false);
        }
      },
    }),
    [store]
  );

  // Wrap host save with:
  //   - onSaveStart / onSaveSuccess / onSaveError lifecycle hooks
  //   - dirty-flag reset on success
  // The error still propagates so TopBar.Save's local "Saving…" → "idle"
  // transition kicks in correctly.
  const wrappedSave = onSave
    ? async (d: Deck) => {
        onSaveStartRef.current?.();
        try {
          await onSaveRef.current!(d);
          savedDeckRef.current = d;
          if (dirtyRef.current) {
            dirtyRef.current = false;
            setDirty(false);
            onDirtyChangeRef.current?.(false);
          }
          onSaveSuccessRef.current?.();
        } catch (err) {
          onSaveErrorRef.current?.(
            err instanceof Error ? err : new Error(String(err))
          );
          throw err;
        }
      }
    : undefined;

  // Merge host's `style` prop with the surface overrides so a host can
  // pass both without one clobbering the other. Surfaces win on conflict
  // because they're the more specific theming intent.
  const surfaceVars = surfacesToCssVars(surfaces);
  const mergedStyle: CSSProperties | undefined = surfaceVars
    ? { ...style, ...(surfaceVars as CSSProperties) }
    : style;

  // Map our reduceMotion enum to:
  //  - a CSS class on the root (drives the @media + class rules in
  //    SlidewiseEditor.css)
  //  - framer-motion's reducedMotion prop on MotionConfig
  const motionClass =
    reduceMotion === true
      ? "reduce-motion"
      : reduceMotion === false
        ? "reduce-motion-off"
        : "";
  const fmReducedMotion =
    reduceMotion === true
      ? "always"
      : reduceMotion === false
        ? "never"
        : "user";
  const combinedClassName = motionClass
    ? className
      ? `${className} ${motionClass}`
      : motionClass
    : className;

  return (
    <MotionConfig reducedMotion={fmReducedMotion} transition={transition}>
      <ReadOnlyProvider readOnly={readOnly}>
        <IconProvider icons={icons ?? {}}>
          <LabelsProvider labels={labels}>
            <SurfacesProvider surfaces={surfaces}>
              <CanvasConfigProvider config={canvas}>
                <DirtyProvider dirty={dirty}>
                  <HostProvider callbacks={{ onSave: wrappedSave, onExport }}>
                    <RootShell
                      fontFamily={fontFamily}
                      className={combinedClassName}
                      style={mergedStyle}
                    >
                      {children}
                    </RootShell>
                  </HostProvider>
                </DirtyProvider>
              </CanvasConfigProvider>
            </SurfacesProvider>
          </LabelsProvider>
        </IconProvider>
      </ReadOnlyProvider>
    </MotionConfig>
  );
}

/**
 * Renders the themed container. Split out so the children read the theme
 * via the store (not props), letting them re-render when the theme flips.
 */
function RootShell({
  fontFamily,
  className,
  style,
  children,
}: PropsWithChildren<{
  fontFamily?: string;
  className?: string;
  style?: CSSProperties;
}>) {
  const theme = useEditor((s) => s.theme);
  const playing = useEditor((s) => s.playing);
  const view = useEditor((s) => s.view);

  const rootStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: "var(--app-bg)",
    color: "var(--ink)",
    overflow: "hidden",
    ...(fontFamily ? { ["--font-geist-sans" as string]: fontFamily } : null),
    ...style,
  };

  return (
    <div
      className={
        className
          ? `slidewise-editor theme-${theme} ${className}`
          : `slidewise-editor theme-${theme}`
      }
      data-slidewise-theme={theme}
      style={rootStyle}
    >
      {children}
      {view === "grid" && <GridView />}
      {playing && <PlayMode />}
    </div>
  );
}

function shallowEqualIds(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
