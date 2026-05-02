import { useEffect, useRef, useState } from "react";
import { Upload, RotateCcw } from "lucide-react";
import { CaracasEditor, type CaracasEditorHandle } from "./CaracasEditor";
import { seedDeck } from "@/lib/seed";
import { parsePptx, serializeDeck } from "@/lib/pptx";
import type { Deck } from "@/lib/types";

const STORAGE_KEY = "caracas-deck";

function loadInitialDeck(): Deck {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Deck;
      if (parsed && Array.isArray(parsed.slides) && parsed.slides.length) {
        return parsed;
      }
    }
  } catch {}
  return seedDeck;
}

export function App() {
  const [deck, setDeck] = useState<Deck>(() => loadInitialDeck());
  const editorRef = useRef<CaracasEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [overlay, setOverlay] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string>("Seed deck");

  const loadFromFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pptx")) {
      setOverlay(`Not a .pptx file: ${file.name}`);
      setTimeout(() => setOverlay(null), 1800);
      return;
    }
    try {
      setOverlay(`Loading ${file.name}…`);
      const next = await parsePptx(file);
      setDeck(next);
      setSourceLabel(file.name);
      setOverlay(`Loaded ${next.slides.length} slides from ${file.name}`);
      setTimeout(() => setOverlay(null), 1600);
    } catch (err) {
      console.error("[caracas] PPTX parse failed:", err);
      setOverlay("Failed to parse .pptx — see console");
      setTimeout(() => setOverlay(null), 2400);
    }
  };

  useEffect(() => {
    let dragDepth = 0;
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      dragDepth++;
      setOverlay("Drop a .pptx to load it");
    };
    const onDragLeave = () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setOverlay(null);
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragDepth = 0;
      setOverlay(null);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      await loadFromFile(file);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = (next: Deck) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.error("Failed to persist deck", err);
    }
  };

  const handleExportPptx = async (current: Deck) => {
    try {
      const blob = await serializeDeck(current);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(current.title || "deck").replace(/[^a-z0-9-_]+/gi, "-")}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[caracas] PPTX export failed:", err);
    }
  };

  const resetToSeed = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setDeck(seedDeck);
    setSourceLabel("Seed deck");
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "#0E1330",
      }}
    >
      <div
        style={{
          flex: "0 0 44px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 14px",
          background: "#0E1330",
          color: "#fff",
          fontFamily: "Inter, system-ui, sans-serif",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, opacity: 0.7 }}>
          CARACAS DEV
        </span>
        <span
          style={{
            fontSize: 12,
            opacity: 0.55,
            padding: "2px 8px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.06)",
          }}
          title="Source of the currently loaded deck"
        >
          {sourceLabel}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={resetToSeed}
          style={chipBtn(false)}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.10)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          title="Reset to the built-in seed deck"
        >
          <RotateCcw size={14} />
          Reset
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={chipBtn(true)}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "rgba(138, 150, 240, 0.95)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "rgba(138, 150, 240, 0.85)")
          }
        >
          <Upload size={14} />
          Open .pptx
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) await loadFromFile(file);
            e.target.value = "";
          }}
          style={{ display: "none" }}
        />
      </div>

      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <CaracasEditor
          ref={editorRef}
          deck={deck}
          onChange={(next) => {
            if (import.meta.env.DEV) {
              console.debug("[caracas] onChange", next.slides.length, "slides");
            }
          }}
          onSave={handleSave}
          onExport={handleExportPptx}
        />
      </div>

      {overlay && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(15, 23, 42, 0.45)",
            color: "#fff",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 18,
            fontWeight: 600,
            zIndex: 999,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              padding: "16px 28px",
              background: "rgba(15, 23, 42, 0.85)",
              borderRadius: 14,
              border: "1px dashed rgba(255,255,255,0.45)",
              backdropFilter: "blur(12px)",
            }}
          >
            {overlay}
          </div>
        </div>
      )}
    </div>
  );
}

function chipBtn(primary: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 28,
    padding: "0 12px",
    borderRadius: 999,
    border: primary
      ? "1px solid rgba(138, 150, 240, 0.85)"
      : "1px solid rgba(255,255,255,0.16)",
    background: primary ? "rgba(138, 150, 240, 0.85)" : "transparent",
    color: primary ? "#0E1330" : "#fff",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
