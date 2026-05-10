import {
  createContext,
  useContext,
  useRef,
  type PropsWithChildren,
} from "react";
import { useStore } from "zustand";
import {
  createEditorStore,
  type EditorState,
  type EditorStore,
} from "./store";
import type { Deck } from "./types";

const EditorStoreContext = createContext<EditorStore | null>(null);

export function EditorStoreProvider({
  initialDeck,
  children,
}: PropsWithChildren<{ initialDeck: Deck }>) {
  const storeRef = useRef<EditorStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createEditorStore(initialDeck);
  }
  return (
    <EditorStoreContext.Provider value={storeRef.current}>
      {children}
    </EditorStoreContext.Provider>
  );
}

export function useEditorStore(): EditorStore {
  const store = useContext(EditorStoreContext);
  if (!store) {
    throw new Error("useEditor must be used within <EditorStoreProvider>");
  }
  return store;
}

export function useEditor<T>(selector: (s: EditorState) => T): T {
  const store = useEditorStore();
  return useStore(store, selector);
}
