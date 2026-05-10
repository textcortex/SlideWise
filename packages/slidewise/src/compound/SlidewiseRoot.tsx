import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
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
import { HostProvider } from "./HostContext";

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
  /** Reserved; not enforced yet. */
  readOnly?: boolean;
  /** "light" | "dark"; first-render only. */
  theme?: "light" | "dark";
  /** Slide id to land on; falls back to the first. */
  initialSlideId?: string;
  /** Override the default Geist font; sets `--slidewise-font-sans`. */
  fontFamily?: string;
  /** Extra class names appended to the root. */
  className?: string;
  /** Inline style applied to the root. */
  style?: CSSProperties;
}

export interface SlidewiseRootHandle {
  play(): void;
  stop(): void;
  undo(): void;
  redo(): void;
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
  theme,
  initialSlideId,
  fontFamily,
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
  const onChangeRef = useRef(onChange);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onSaveRef = useRef(onSave);
  const onExportRef = useRef(onExport);

  useEffect(() => {
    onChangeRef.current = onChange;
    onDirtyChangeRef.current = onDirtyChange;
    onSaveRef.current = onSave;
    onExportRef.current = onExport;
  }, [onChange, onDirtyChange, onSave, onExport]);

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
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Wrap host save with dirty-flag reset so any TopBar.Save / imperative save
  // path that funnels through here clears the dirty state on success.
  const wrappedSave = onSave
    ? async (d: Deck) => {
        await onSaveRef.current!(d);
        savedDeckRef.current = d;
        if (dirtyRef.current) {
          dirtyRef.current = false;
          onDirtyChangeRef.current?.(false);
        }
      }
    : undefined;

  return (
    <HostProvider callbacks={{ onSave: wrappedSave, onExport }}>
      <RootShell
        fontFamily={fontFamily}
        className={className}
        style={style}
      >
        {children}
      </RootShell>
    </HostProvider>
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
