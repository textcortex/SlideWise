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

/**
 * Idle window in ms during which consecutive mutations with the same coalesce
 * key collapse into a single history step. After this many ms with no edit,
 * the next edit starts a fresh step. Drags on a single element typically run
 * 60+ frames in well under this window; typing pauses around word boundaries
 * usually exceed it. Hosts that want stricter granularity can call
 * `endCoalesce()` explicitly (e.g. on mouseup or input blur).
 */
const COALESCE_IDLE_MS = 500;
const HISTORY_LIMIT = 50;

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
  /**
   * Coalesce key for the in-flight mutation burst. Two consecutive mutations
   * with the same key (within `COALESCE_IDLE_MS`) collapse into one history
   * step. `null` means "no burst in progress" — the next edit pushes a fresh
   * snapshot.
   */
  _coalesceKey: string | null;
  _coalesceUntil: number;

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
  /**
   * Push a history snapshot, but only if `key` differs from the in-flight
   * coalesce key OR more than `COALESCE_IDLE_MS` have passed since the last
   * mutation. Use this for high-frequency edits (text typing, drag) so the
   * burst collapses into one undo step.
   */
  pushHistoryCoalesced: (key: string) => void;
  /**
   * End the current coalesce burst. Hosts call this on natural commit
   * boundaries (mouseup after a drag, blur on a text input) so the next
   * mutation starts a fresh history step even within `COALESCE_IDLE_MS`.
   */
  endCoalesce: () => void;
  /** True iff there's at least one snapshot to undo back to. */
  canUndo: () => boolean;
  /** True iff there's at least one snapshot to redo forward to. */
  canRedo: () => boolean;
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
    _coalesceKey: null,
    _coalesceUntil: 0,

    currentSlide: () => {
      const s = get();
      return (
        s.deck.slides.find((sl) => sl.id === s.currentSlideId) ??
        s.deck.slides[0]
      );
    },

    pushHistory: () => {
      set((s) => ({
        history: [...s.history, snap(s)].slice(-HISTORY_LIMIT),
        future: [],
        _coalesceKey: null,
        _coalesceUntil: 0,
      }));
    },

    pushHistoryCoalesced: (key) => {
      const now = Date.now();
      set((s) => {
        // Same burst within the idle window → don't push, just extend.
        if (s._coalesceKey === key && now < s._coalesceUntil) {
          return { _coalesceUntil: now + COALESCE_IDLE_MS };
        }
        // New burst — snapshot the pre-mutation state and start coalescing.
        return {
          history: [...s.history, snap(s)].slice(-HISTORY_LIMIT),
          future: [],
          _coalesceKey: key,
          _coalesceUntil: now + COALESCE_IDLE_MS,
        };
      });
    },

    endCoalesce: () => {
      set({ _coalesceKey: null, _coalesceUntil: 0 });
    },

    canUndo: () => get().history.length > 0,
    canRedo: () => get().future.length > 0,

    setTool: (t) => set({ tool: t }),
    setTitle: (t) => {
      get().pushHistoryCoalesced("setTitle");
      set((s) => ({ deck: { ...s.deck, title: t } }));
    },
    setZoom: (z) =>
      set({ zoom: Math.max(0.1, Math.min(4, z)), fitMode: "manual" }),
    setFitMode: (f) => set({ fitMode: f }),

    selectSlide: (id) =>
      set({ currentSlideId: id, selectedIds: [], _coalesceKey: null }),
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
      // Coalesce key: same element, same patch shape = same burst.
      // Drag (x,y) coalesces; resize (w,h) starts a new burst even on the
      // same element; switching elements also starts fresh.
      const key = `updateElement:${id}:${Object.keys(patch).sort().join(",")}`;
      get().pushHistoryCoalesced(key);
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
          future: [...s.future, snapshot].slice(-HISTORY_LIMIT),
          selectedIds: survivingIds,
          _coalesceKey: null,
          _coalesceUntil: 0,
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
          history: [...s.history, snapshot].slice(-HISTORY_LIMIT),
          future: s.future.slice(0, -1),
          selectedIds: survivingIds,
          _coalesceKey: null,
          _coalesceUntil: 0,
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
        _coalesceKey: null,
        _coalesceUntil: 0,
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
