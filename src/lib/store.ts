import { createStore, type StoreApi } from "zustand/vanilla";
import { nanoid } from "nanoid";
import type {
  Deck,
  Slide,
  SlideElement,
  ElementDraft,
  ShapeKind,
} from "./types";
import { SLIDE_W, SLIDE_H } from "./types";
import { migrate } from "./schema/migrate";

type Tool =
  | "select"
  | "text"
  | "shape"
  | "line"
  | "image"
  | "table"
  | "formula"
  | "icon"
  | "embed";

interface HistorySnapshot {
  deck: Deck;
  currentSlideId: string;
}

type Theme = "light" | "dark";
type View = "editor" | "grid";

export interface EditorState {
  deck: Deck;
  currentSlideId: string;
  selectedIds: string[];
  tool: Tool;
  zoom: number;
  fitMode: "fit" | "fill" | "manual";
  playing: boolean;
  theme: Theme;
  view: View;
  history: HistorySnapshot[];
  future: HistorySnapshot[];

  // selectors
  currentSlide: () => Slide;

  // actions
  setTool: (t: Tool) => void;
  setTitle: (t: string) => void;
  setZoom: (z: number) => void;
  setFitMode: (f: "fit" | "fill" | "manual") => void;
  selectSlide: (id: string) => void;
  selectElement: (id: string | null, additive?: boolean) => void;
  clearSelection: () => void;
  addSlide: (afterId?: string) => void;
  duplicateSlide: (id: string) => void;
  deleteSlide: (id: string) => void;
  reorderSlide: (id: string, toIndex: number) => void;
  addElement: (partial: ElementDraft) => string;
  updateElement: (id: string, patch: Partial<SlideElement>) => void;
  deleteElement: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  setBackground: (color: string) => void;
  play: () => void;
  stop: () => void;
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  setDeck: (deck: Deck) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setView: (v: View) => void;
}

export type EditorStore = StoreApi<EditorState>;

const blankSlide = (): Slide => ({
  id: nanoid(8),
  background: "#FFFFFF",
  elements: [],
});

function snap(state: EditorState): HistorySnapshot {
  return {
    deck: structuredClone(state.deck),
    currentSlideId: state.currentSlideId,
  };
}

export function createEditorStore(initialDeck: Deck): EditorStore {
  // Run external decks through the migrator so the store always holds a
  // current-shape Deck — even when the host hands us something written by
  // an older Slidewise.
  const deck = migrate(initialDeck);
  const firstSlideId = deck.slides[0]?.id ?? "";
  return createStore<EditorState>((set, get) => ({
    deck,
    currentSlideId: firstSlideId,
    selectedIds: [],
    tool: "select",
    zoom: 0.6,
    fitMode: "fit",
    playing: false,
    theme: "light",
    view: "editor",
    history: [],
    future: [],

    currentSlide: () => {
      const s = get();
      return (
        s.deck.slides.find((sl) => sl.id === s.currentSlideId) ??
        s.deck.slides[0]
      );
    },

    pushHistory: () => {
      set((s) => ({
        history: [...s.history, snap(s)].slice(-50),
        future: [],
      }));
    },

    setTool: (t) => set({ tool: t }),
    setTitle: (t) => {
      set((s) => ({ deck: { ...s.deck, title: t } }));
    },
    setZoom: (z) =>
      set({ zoom: Math.max(0.1, Math.min(4, z)), fitMode: "manual" }),
    setFitMode: (f) => set({ fitMode: f }),

    selectSlide: (id) => set({ currentSlideId: id, selectedIds: [] }),
    selectElement: (id, additive) =>
      set((s) => {
        if (id == null) return { selectedIds: [] };
        if (additive) {
          const has = s.selectedIds.includes(id);
          return {
            selectedIds: has
              ? s.selectedIds.filter((x) => x !== id)
              : [...s.selectedIds, id],
          };
        }
        return { selectedIds: [id] };
      }),
    clearSelection: () => set({ selectedIds: [] }),

    addSlide: (afterId) => {
      get().pushHistory();
      set((s) => {
        const slide = blankSlide();
        const slides = [...s.deck.slides];
        const idx = afterId
          ? slides.findIndex((sl) => sl.id === afterId)
          : slides.length - 1;
        slides.splice(idx + 1, 0, slide);
        return {
          deck: { ...s.deck, slides },
          currentSlideId: slide.id,
          selectedIds: [],
        };
      });
    },

    duplicateSlide: (id) => {
      get().pushHistory();
      set((s) => {
        const slides = [...s.deck.slides];
        const idx = slides.findIndex((sl) => sl.id === id);
        if (idx < 0) return s;
        const orig = slides[idx];
        const copy: Slide = {
          ...structuredClone(orig),
          id: nanoid(8),
          elements: orig.elements.map((e) => ({ ...e, id: nanoid(8) })),
        };
        slides.splice(idx + 1, 0, copy);
        return {
          deck: { ...s.deck, slides },
          currentSlideId: copy.id,
        };
      });
    },

    deleteSlide: (id) => {
      if (get().deck.slides.length <= 1) return;
      get().pushHistory();
      set((s) => {
        const slides = s.deck.slides.filter((sl) => sl.id !== id);
        const wasCurrent = s.currentSlideId === id;
        return {
          deck: { ...s.deck, slides },
          currentSlideId: wasCurrent ? slides[0].id : s.currentSlideId,
          selectedIds: [],
        };
      });
    },

    reorderSlide: (id, toIndex) => {
      get().pushHistory();
      set((s) => {
        const slides = [...s.deck.slides];
        const from = slides.findIndex((sl) => sl.id === id);
        if (from < 0) return s;
        const [moved] = slides.splice(from, 1);
        slides.splice(toIndex, 0, moved);
        return { deck: { ...s.deck, slides } };
      });
    },

    addElement: (partial) => {
      get().pushHistory();
      const id = nanoid(8);
      set((s) => {
        const slides = s.deck.slides.map((sl) => {
          if (sl.id !== s.currentSlideId) return sl;
          const z = (sl.elements.reduce((m, e) => Math.max(m, e.z), 0) ?? 0) + 1;
          return {
            ...sl,
            elements: [...sl.elements, { ...partial, id, z } as SlideElement],
          };
        });
        return { deck: { ...s.deck, slides }, selectedIds: [id] };
      });
      return id;
    },

    updateElement: (id, patch) => {
      set((s) => {
        const slides = s.deck.slides.map((sl) => {
          if (sl.id !== s.currentSlideId) return sl;
          return {
            ...sl,
            elements: sl.elements.map((e) =>
              e.id === id ? ({ ...e, ...patch } as SlideElement) : e
            ),
          };
        });
        return { deck: { ...s.deck, slides } };
      });
    },

    deleteElement: (id) => {
      get().pushHistory();
      set((s) => {
        const slides = s.deck.slides.map((sl) => {
          if (sl.id !== s.currentSlideId) return sl;
          return { ...sl, elements: sl.elements.filter((e) => e.id !== id) };
        });
        return {
          deck: { ...s.deck, slides },
          selectedIds: s.selectedIds.filter((x) => x !== id),
        };
      });
    },

    bringForward: (id) => {
      get().pushHistory();
      set((s) => {
        const slides = s.deck.slides.map((sl) => {
          if (sl.id !== s.currentSlideId) return sl;
          const maxZ = sl.elements.reduce((m, e) => Math.max(m, e.z), 0);
          return {
            ...sl,
            elements: sl.elements.map((e) =>
              e.id === id ? { ...e, z: maxZ + 1 } : e
            ),
          };
        });
        return { deck: { ...s.deck, slides } };
      });
    },

    sendBackward: (id) => {
      get().pushHistory();
      set((s) => {
        const slides = s.deck.slides.map((sl) => {
          if (sl.id !== s.currentSlideId) return sl;
          const minZ = sl.elements.reduce((m, e) => Math.min(m, e.z), 0);
          return {
            ...sl,
            elements: sl.elements.map((e) =>
              e.id === id ? { ...e, z: minZ - 1 } : e
            ),
          };
        });
        return { deck: { ...s.deck, slides } };
      });
    },

    setBackground: (color) => {
      get().pushHistory();
      set((s) => {
        const slides = s.deck.slides.map((sl) =>
          sl.id === s.currentSlideId ? { ...sl, background: color } : sl
        );
        return { deck: { ...s.deck, slides } };
      });
    },

    play: () => set({ playing: true, selectedIds: [] }),
    stop: () => set({ playing: false }),

    undo: () => {
      set((s) => {
        const last = s.history[s.history.length - 1];
        if (!last) return s;
        const snapshot = snap(s);
        const targetSlide = last.deck.slides.find(
          (sl) => sl.id === last.currentSlideId
        );
        const survivingIds = targetSlide
          ? s.selectedIds.filter((id) =>
              targetSlide.elements.some((e) => e.id === id)
            )
          : [];
        return {
          deck: last.deck,
          currentSlideId: last.currentSlideId,
          history: s.history.slice(0, -1),
          future: [...s.future, snapshot].slice(-50),
          selectedIds: survivingIds,
        };
      });
    },

    redo: () => {
      set((s) => {
        const next = s.future[s.future.length - 1];
        if (!next) return s;
        const snapshot = snap(s);
        const targetSlide = next.deck.slides.find(
          (sl) => sl.id === next.currentSlideId
        );
        const survivingIds = targetSlide
          ? s.selectedIds.filter((id) =>
              targetSlide.elements.some((e) => e.id === id)
            )
          : [];
        return {
          deck: next.deck,
          currentSlideId: next.currentSlideId,
          history: [...s.history, snapshot].slice(-50),
          future: s.future.slice(0, -1),
          selectedIds: survivingIds,
        };
      });
    },

    setDeck: (deck) => {
      const migrated = migrate(deck);
      set({
        deck: migrated,
        currentSlideId: migrated.slides[0]?.id ?? "",
        selectedIds: [],
        history: [],
        future: [],
      });
    },

    setTheme: (t) => set({ theme: t }),

    toggleTheme: () => {
      const next = get().theme === "light" ? "dark" : "light";
      get().setTheme(next);
    },

    setView: (v) => set({ view: v }),
  }));
}

export type { Tool };
export { SLIDE_W, SLIDE_H };

export const presetShapes: ShapeKind[] = [
  "rect",
  "rounded",
  "circle",
  "triangle",
  "diamond",
  "star",
];
