import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { CaracasEditor, type CaracasEditorHandle } from "./CaracasEditor";
import { parsePptx, serializeDeck } from "@/lib/pptx";
import type { Deck } from "@/lib/types";

export interface CaracasFileEditorProps {
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
  /** Disables editing affordances (TODO: not yet enforced). */
  editable?: boolean;
  /**
   * The sha256 of the file's contents at load time, if the host wants to do
   * conflict detection. Stored verbatim and surfaced via `getInitialSha256()`
   * — Caracas itself doesn't read it; the host's saveBlob implementation does.
   */
  initialSha256?: string | null;
  /**
   * Receives an imperative API for save / dirty-tracking / play once the
   * editor is mounted. Called with `null` on unmount.
   */
  onEditorApiChange?: (api: CaracasFileEditorApi | null) => void;
  theme?: "light" | "dark";
  className?: string;
  style?: CSSProperties;
  /**
   * Optional override for how the file is parsed. Default uses Caracas's
   * built-in PPTX parser. Useful for testing or for hosting a different
   * binary deck format on top of the editor.
   */
  parse?: (blob: Blob | ArrayBuffer) => Promise<Deck>;
  /**
   * Optional override for how the file is serialized. Default uses
   * Caracas's built-in PPTX writer.
   */
  serialize?: (deck: Deck) => Promise<Blob>;
}

export interface CaracasFileEditorApi {
  save(): Promise<void>;
  isDirty(): boolean;
  play(): void;
  stop(): void;
  undo(): void;
  redo(): void;
  getInitialSha256(): string | null;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; deck: Deck };

export const CaracasFileEditor = forwardRef<
  CaracasFileEditorApi,
  CaracasFileEditorProps
>(function CaracasFileEditor(
  {
    loadBlob,
    saveBlob,
    initialSha256 = null,
    onEditorApiChange,
    theme,
    className,
    style,
    parse = parsePptx,
    serialize = serializeDeck,
  },
  ref
) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const editorRef = useRef<CaracasEditorHandle>(null);
  const [dirty, setDirty] = useState(false);
  const apiCallbackRef = useRef(onEditorApiChange);

  useEffect(() => {
    apiCallbackRef.current = onEditorApiChange;
  }, [onEditorApiChange]);

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
        if (!cancelled) {
          setState({
            status: "error",
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
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

    const api: CaracasFileEditorApi = {
      save: async () => {
        const current =
          editorRef.current?.getDeck() ?? state.deck;
        const blob = await serialize(current);
        await saveBlob(blob);
        editorRef.current?.resetDirty();
      },
      isDirty: () => editorRef.current?.isDirty() ?? false,
      play: () => editorRef.current?.play(),
      stop: () => editorRef.current?.stop(),
      undo: () => editorRef.current?.undo(),
      redo: () => editorRef.current?.redo(),
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
      <CaracasEditor
        ref={editorRef}
        deck={state.deck}
        theme={theme}
        onDirtyChange={setDirty}
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

export default CaracasFileEditor;
