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
  /** Render the floating bottom toolbar. Default `true`. */
  showBottomToolbar?: boolean;
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
    theme,
    initialSlideId,
    showTopBar,
    showBottomToolbar,
    fontFamily,
    icons,
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
        <div style={messageStyle}>Loading…</div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div style={{ ...frameStyle, ...style }} className={className}>
        <div style={{ ...messageStyle, color: "#E8504C" }}>
          Could not open file: {state.error.message}
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
        fontFamily={fontFamily}
        icons={icons}
        onChange={(next) => {
          onChangeRef.current?.(next);
        }}
        onDirtyChange={(d) => {
          setDirty(d);
          onDirtyChangeRef.current?.(d);
        }}
        onSave={async (next) => {
          const blob = await serialize(next);
          await saveBlob(blob);
        }}
      />
      {dirty && <UnsavedBadge />}
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

function UnsavedBadge() {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        padding: "4px 10px",
        background: "rgba(232, 80, 76, 0.12)",
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
      Unsaved changes
    </div>
  );
}

export default SlidewiseFileEditor;
