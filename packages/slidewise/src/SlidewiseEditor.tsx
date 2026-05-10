import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type Ref,
} from "react";
import { Editor } from "@/components/editor/Editor";
import {
  EditorStoreProvider,
  useEditorStore,
} from "@/lib/StoreProvider";
import { collectFontFamilies, ensureGoogleFontsLoaded } from "@/lib/fonts";
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
  /** Reserved for future use; not enforced yet. */
  readOnly?: boolean;
  /** "light" or "dark"; defaults to "light". Ignored after first render. */
  theme?: "light" | "dark";
  /** Slide id to land on; falls back to the first slide. */
  initialSlideId?: string;
  /** Render the built-in top bar (title, undo/redo, save, play). Default true. */
  showTopBar?: boolean;
  /** Override the bundled Geist font; sets `--font-geist-sans` on the root. */
  fontFamily?: string;
  /** Extra class names appended to the editor root. */
  className?: string;
  /** Inline style applied to the editor root. */
  style?: CSSProperties;
}

export interface SlidewiseEditorHandle {
  play(): void;
  stop(): void;
  undo(): void;
  redo(): void;
  getDeck(): Deck;
  isDirty(): boolean;
  resetDirty(): void;
}

export const SlidewiseEditor = forwardRef<
  SlidewiseEditorHandle,
  SlidewiseEditorProps
>(function SlidewiseEditor(props, ref) {
  return (
    <EditorStoreProvider initialDeck={props.deck}>
      <SlidewiseEditorInner {...props} forwardedRef={ref} />
    </EditorStoreProvider>
  );
});

function SlidewiseEditorInner({
  deck,
  onChange,
  onSave,
  onExport,
  onDirtyChange,
  theme,
  initialSlideId,
  showTopBar,
  fontFamily,
  className,
  style,
  forwardedRef,
}: SlidewiseEditorProps & { forwardedRef: Ref<SlidewiseEditorHandle> }) {
  const store = useEditorStore();
  const savedDeckRef = useRef<Deck>(deck);
  const dirtyRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onDirtyChangeRef = useRef(onDirtyChange);

  // Keep callback refs current without re-subscribing.
  useEffect(() => {
    onChangeRef.current = onChange;
    onDirtyChangeRef.current = onDirtyChange;
  }, [onChange, onDirtyChange]);

  // Apply theme on first render and whenever it changes.
  useEffect(() => {
    if (theme) {
      store.getState().setTheme(theme);
    }
  }, [theme, store]);

  // Land on the requested slide.
  useEffect(() => {
    if (initialSlideId) {
      const exists = store
        .getState()
        .deck.slides.some((s) => s.id === initialSlideId);
      if (exists) {
        store.getState().selectSlide(initialSlideId);
      }
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External deck reset: if a new Deck reference comes in, replace the store's
  // deck and clear dirty. The first run is a no-op (savedDeckRef === deck).
  useEffect(() => {
    if (deck !== savedDeckRef.current) {
      store.getState().setDeck(deck);
      savedDeckRef.current = deck;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        onDirtyChangeRef.current?.(false);
      }
    }
  }, [deck, store]);

  // Subscribe once: emit onChange, recompute dirty, and refresh the Google
  // Fonts <link> whenever the deck changes.
  const instanceId = useId().replace(/[^a-z0-9]/gi, "");
  useEffect(() => {
    ensureGoogleFontsLoaded(
      instanceId,
      collectFontFamilies(store.getState().deck)
    );
    return store.subscribe((state, prev) => {
      if (state.deck === prev.deck) return;
      onChangeRef.current?.(state.deck);
      const nextDirty = state.deck !== savedDeckRef.current;
      if (nextDirty !== dirtyRef.current) {
        dirtyRef.current = nextDirty;
        onDirtyChangeRef.current?.(nextDirty);
      }
      ensureGoogleFontsLoaded(instanceId, collectFontFamilies(state.deck));
    });
  }, [store, instanceId]);

  // Remove our font <link> when the editor unmounts.
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
      getDeck: () => store.getState().deck,
      isDirty: () => dirtyRef.current,
      resetDirty: () => {
        savedDeckRef.current = store.getState().deck;
        if (dirtyRef.current) {
          dirtyRef.current = false;
          onDirtyChangeRef.current?.(false);
        }
      },
    }),
    [store]
  );

  // Wrap the host save callback so a successful save resets the dirty flag.
  const handleSave = onSave
    ? async (d: Deck) => {
        await onSave(d);
        savedDeckRef.current = d;
        if (dirtyRef.current) {
          dirtyRef.current = false;
          onDirtyChangeRef.current?.(false);
        }
      }
    : undefined;

  const rootStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    ...(fontFamily ? { ["--font-geist-sans" as string]: fontFamily } : null),
    ...style,
  };

  return (
    <div
      className={className ? `slidewise-editor-host ${className}` : "slidewise-editor-host"}
      style={rootStyle}
    >
      <Editor
        showTopBar={showTopBar !== false}
        onSave={handleSave}
        onExport={onExport}
      />
    </div>
  );
}

export default SlidewiseEditor;
