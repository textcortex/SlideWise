import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Upload,
  RotateCcw,
  Sparkles,
  MessageSquare,
  Wand2,
  ArrowLeft,
  ArrowRight,
  CloudUpload,
  ChevronLeft,
  Share2,
} from "lucide-react";
import {
  SlidewiseEditor,
  type SlidewiseEditorHandle,
  parsePptx,
  serializeDeck,
  type Deck,
  Root,
  TopBar,
  SlideRail,
  Canvas,
  BottomToolbar,
  RightPanel,
  Body,
  CanvasFrame,
} from "@textcortex/slidewise";
import "@textcortex/slidewise/style.css";
import { seedDeck } from "./seed";

const STORAGE_KEY = "slidewise-deck";

type DemoId =
  | "default"
  | "no-bottom-toolbar"
  | "right-panel"
  | "retheme"
  | "icons"
  | "read-only"
  | "topbar-hide"
  | "topbar-compound";

interface Demo {
  id: DemoId;
  label: string;
  description: string;
}

const DEMOS: Demo[] = [
  {
    id: "default",
    label: "Default",
    description:
      "<SlidewiseEditor /> renders the standard tree — top bar, slide rail, canvas, and bottom toolbar.",
  },
  {
    id: "no-bottom-toolbar",
    label: "No bottom toolbar",
    description:
      "Same editor with showBottomToolbar={false}. Equivalent to omitting <Slidewise.BottomToolbar /> from the compound tree.",
  },
  {
    id: "right-panel",
    label: "Right panel",
    description:
      "Composed via the compound primitives with <Slidewise.RightPanel> containing host UI. Demos how AI suggestions or comments would slot in.",
  },
  {
    id: "retheme",
    label: "Themed override",
    description:
      "Default tree with --surface-bg / --app-bg / --rail-bg overridden via inline style on <Slidewise.Root>. Shows that hosts can retheme without forking.",
  },
  {
    id: "icons",
    label: "Custom icons",
    description:
      "icons={{ undo, redo, save, export, smart }} swaps lucide for an alternate set. Hosts use this to skin Slidewise with their own icon library (Nucleo, custom SVGs, etc.) without forking.",
  },
  {
    id: "read-only",
    label: "Read-only viewer",
    description:
      "editable={false} hides save/undo/redo and locks the title input. Use this for public viewers or non-owners.",
  },
  {
    id: "topbar-hide",
    label: "TopBar hide",
    description:
      "<Slidewise.TopBar hide={['export','play']} /> drops individual buttons from the default arrangement without going full compound.",
  },
  {
    id: "topbar-compound",
    label: "TopBar compound",
    description:
      "Full <Slidewise.TopBar.Root> with host buttons mixed in: an Exit button leftmost, a Share button rightmost, and the built-in subparts reordered between them.",
  },
];

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
  const editorRef = useRef<SlidewiseEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [overlay, setOverlay] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string>("Seed deck");
  const [activeDemo, setActiveDemo] = useState<DemoId>("default");
  // Original PPTX bytes for whatever was last loaded. Kept here (not on
  // the Deck) so the bytes survive the editor's immutable state updates,
  // Zustand snapshots, and the localStorage JSON round-trip — all of
  // which strip non-enumerable / non-JSON properties. Required by
  // serializeDeck to round-trip per-element source XML (gradient panels,
  // custGeom marks, charts, SmartArt) without dropping them.
  const sourcePptxRef = useRef<ArrayBuffer | undefined>(undefined);

  const loadFromFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pptx")) {
      setOverlay(`Not a .pptx file: ${file.name}`);
      setTimeout(() => setOverlay(null), 1800);
      return;
    }
    try {
      setOverlay(`Loading ${file.name}…`);
      const buffer = await file.arrayBuffer();
      sourcePptxRef.current = buffer;
      const next = await parsePptx(buffer);
      setDeck(next);
      setSourceLabel(file.name);
      setOverlay(`Loaded ${next.slides.length} slides from ${file.name}`);
      setTimeout(() => setOverlay(null), 1600);
    } catch (err) {
      console.error("[slidewise] PPTX parse failed:", err);
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
      const blob = await serializeDeck(current, {
        source: sourcePptxRef.current,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(current.title || "deck").replace(/[^a-z0-9-_]+/gi, "-")}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[slidewise] PPTX export failed:", err);
    }
  };

  const resetToSeed = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setDeck(seedDeck);
    setSourceLabel("Seed deck");
  };

  const activeDemoMeta = useMemo(
    () => DEMOS.find((d) => d.id === activeDemo) ?? DEMOS[0],
    [activeDemo]
  );

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
          SLIDEWISE DEV
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

      <div
        style={{
          flex: "0 0 64px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          background: "#0E1330",
          color: "#fff",
          fontFamily: "Inter, system-ui, sans-serif",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          {DEMOS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setActiveDemo(d.id)}
              style={tabBtn(activeDemo === d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.6)",
            maxWidth: 760,
            lineHeight: 1.4,
          }}
        >
          {activeDemoMeta.description}
        </div>
      </div>

      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <DemoSurface
          demoId={activeDemo}
          deck={deck}
          editorRef={editorRef}
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

interface DemoProps {
  demoId: DemoId;
  deck: Deck;
  editorRef: React.Ref<SlidewiseEditorHandle>;
  onSave: (deck: Deck) => void;
  onExport: (deck: Deck) => void;
}

function DemoSurface({ demoId, deck, editorRef, onSave, onExport }: DemoProps) {
  const onChangeLog = (next: Deck) => {
    if (import.meta.env.DEV) {
      console.debug("[slidewise] onChange", next.slides.length, "slides");
    }
  };

  if (demoId === "default") {
    return (
      <SlidewiseEditor
        ref={editorRef}
        deck={deck}
        onChange={onChangeLog}
        onSave={onSave}
        onExport={onExport}
      />
    );
  }

  if (demoId === "no-bottom-toolbar") {
    return (
      <SlidewiseEditor
        ref={editorRef}
        deck={deck}
        showBottomToolbar={false}
        onChange={onChangeLog}
        onSave={onSave}
        onExport={onExport}
      />
    );
  }

  if (demoId === "right-panel") {
    return (
      <Root
        ref={editorRef}
        deck={deck}
        onChange={onChangeLog}
        onSave={onSave}
        onExport={onExport}
      >
        <TopBar />
        <Body>
          <SlideRail />
          <CanvasFrame>
            <Canvas />
            <BottomToolbar />
          </CanvasFrame>
          <RightPanel width={300}>
            <DemoRightPanel />
          </RightPanel>
        </Body>
      </Root>
    );
  }

  if (demoId === "icons") {
    // Swap a few lucide icons for alternate lucide icons to demonstrate
    // overrides. Hosts in production would pass their own icon set
    // (Nucleo, custom SVGs, Heroicons, etc.) the same way.
    return (
      <SlidewiseEditor
        ref={editorRef}
        deck={deck}
        onChange={onChangeLog}
        onSave={onSave}
        onExport={onExport}
        icons={{
          undo: <ArrowLeft size={16} />,
          redo: <ArrowRight size={16} />,
          smart: <Wand2 size={11} />,
          export: <CloudUpload size={14} />,
        }}
      />
    );
  }

  if (demoId === "topbar-hide") {
    return (
      <Root
        ref={editorRef}
        deck={deck}
        onChange={onChangeLog}
        onSave={onSave}
        onExport={onExport}
      >
        <TopBar hide={["export", "play"]} />
        <Body>
          <SlideRail />
          <CanvasFrame>
            <Canvas />
            <BottomToolbar />
          </CanvasFrame>
        </Body>
      </Root>
    );
  }

  if (demoId === "topbar-compound") {
    return (
      <Root
        ref={editorRef}
        deck={deck}
        onChange={onChangeLog}
        onSave={onSave}
        onExport={onExport}
      >
        <TopBar.Root>
          <button type="button" style={hostTopBarBtn()}>
            <ChevronLeft size={14} />
            Exit
          </button>
          <TopBar.Group>
            <TopBar.Undo />
            <TopBar.Redo />
          </TopBar.Group>
          <TopBar.Title />
          <TopBar.ThemeToggle />
          <TopBar.Save />
          <TopBar.Export />
          <button type="button" style={hostTopBarBtn()}>
            <Share2 size={14} />
            Share
          </button>
        </TopBar.Root>
        <Body>
          <SlideRail />
          <CanvasFrame>
            <Canvas />
            <BottomToolbar />
          </CanvasFrame>
        </Body>
      </Root>
    );
  }

  if (demoId === "read-only") {
    return (
      <SlidewiseEditor
        ref={editorRef}
        deck={deck}
        readOnly
        onChange={onChangeLog}
        onSave={onSave}
        onExport={onExport}
      />
    );
  }

  if (demoId === "retheme") {
    return (
      <Root
        ref={editorRef}
        deck={deck}
        onChange={onChangeLog}
        onSave={onSave}
        onExport={onExport}
        theme="dark"
        style={
          {
            // Override a handful of surface tokens to demonstrate that hosts
            // retheme by setting CSS variables — no fork required.
            "--surface-bg": "#11131c",
            "--surface-hover-bg": "#16182a",
            "--surface-ring": "rgba(125, 91, 223, 0.25)",
            "--app-bg": "#0a0d1c",
            "--rail-bg": "#0c0f1a",
          } as CSSProperties
        }
      >
        <TopBar />
        <Body>
          <SlideRail />
          <CanvasFrame>
            <Canvas />
            <BottomToolbar />
          </CanvasFrame>
        </Body>
      </Root>
    );
  }

  return null;
}

function DemoRightPanel() {
  return (
    <div
      style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        color: "var(--ink)",
        fontFamily: "var(--font-geist-sans), Inter, system-ui, sans-serif",
        fontSize: 13,
      }}
    >
      <div
        className="slidewise-surface"
        data-interactive="true"
        style={{ padding: 14, display: "flex", gap: 10, alignItems: "flex-start" }}
      >
        <Sparkles size={18} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>AI suggestion</div>
          <div style={{ color: "var(--ink-muted)", lineHeight: 1.5 }}>
            "Tighten this slide to a single sentence." Compose your own panel
            here and Slidewise's surface tokens will style it consistently.
          </div>
        </div>
      </div>
      <div
        className="slidewise-surface"
        data-interactive="true"
        style={{ padding: 14, display: "flex", gap: 10, alignItems: "flex-start" }}
      >
        <MessageSquare size={18} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Comments</div>
          <div style={{ color: "var(--ink-muted)", lineHeight: 1.5 }}>
            Empty placeholder. Hosts inject any React tree they want into
            &lt;Slidewise.RightPanel&gt;.
          </div>
        </div>
      </div>
    </div>
  );
}

function hostTopBarBtn(): CSSProperties {
  return {
    height: 32,
    padding: "0 12px",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--slidewise-radius, 10px)",
    cursor: "pointer",
    color: "var(--ink)",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "inherit",
  };
}

function chipBtn(primary: boolean): CSSProperties {
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

function tabBtn(active: boolean): CSSProperties {
  return {
    height: 32,
    padding: "0 14px",
    borderRadius: 8,
    border: active
      ? "1px solid rgba(138, 150, 240, 0.85)"
      : "1px solid rgba(255,255,255,0.12)",
    background: active ? "rgba(138, 150, 240, 0.18)" : "transparent",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background 120ms, border-color 120ms",
  };
}
