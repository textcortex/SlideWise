import {
  MousePointer2,
  Type,
  Shapes,
  Spline,
  Image as ImageIcon,
  Table2,
  Sigma,
  Sparkles,
  MonitorPlay,
  Maximize2,
  ChevronDown,
} from "lucide-react";
import { useEditor } from "@/lib/StoreProvider";
import type { Tool } from "@/lib/store";

export function BottomToolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const fitMode = useEditor((s) => s.fitMode);
  const setFitMode = useEditor((s) => s.setFitMode);

  const items: { id: Tool; icon: React.ReactNode; label: string }[] = [
    { id: "select", icon: <MousePointer2 size={18} />, label: "Select (V)" },
    { id: "text", icon: <Type size={18} />, label: "Text (T)" },
    { id: "shape", icon: <Shapes size={18} />, label: "Shape (S)" },
    { id: "line", icon: <Spline size={18} />, label: "Line (L)" },
    { id: "image", icon: <ImageIcon size={18} />, label: "Image (I)" },
    { id: "table", icon: <Table2 size={18} />, label: "Table" },
    { id: "formula", icon: <Sigma size={18} />, label: "Formula" },
    { id: "icon", icon: <Sparkles size={18} />, label: "Icon" },
    { id: "embed", icon: <MonitorPlay size={18} />, label: "Embed" },
  ];

  return (
    <div
      style={{
        position: "absolute",
        bottom: 18,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: 8,
        background: "var(--toolbar-bg)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid var(--border)",
        borderRadius: 18,
        boxShadow: "var(--toolbar-shadow)",
        zIndex: 20,
        color: "var(--ink)",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {items.map((it) => {
        const active = tool === it.id;
        return (
          <button
            key={it.id}
            title={it.label}
            aria-label={it.label}
            aria-pressed={active}
            onClick={() => setTool(it.id)}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: active ? "var(--tool-active-bg)" : "transparent",
              color: active ? "var(--tool-active-fg)" : "var(--ink)",
              transition: "background 120ms ease, color 120ms ease",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = "var(--hover)";
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = "transparent";
            }}
          >
            {it.icon}
          </button>
        );
      })}

      <div style={{ width: 1, height: 24, background: "var(--border-strong)", margin: "0 6px" }} />

      <button
        title="Fit to window"
        aria-label="Fit slide to window"
        onClick={() => setFitMode("fit")}
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: fitMode === "fit" ? "var(--active)" : "transparent",
          color: "var(--ink)",
        }}
      >
        <Maximize2 size={16} />
      </button>

      <ZoomMenu
        zoom={zoom}
        fitMode={fitMode}
        onChange={(z) => setZoom(z)}
        onFit={() => setFitMode("fit")}
      />
    </div>
  );
}

function ZoomMenu({
  zoom,
  fitMode,
  onChange,
  onFit,
}: {
  zoom: number;
  fitMode: "fit" | "fill" | "manual";
  onChange: (z: number) => void;
  onFit: () => void;
}) {
  const presets = [0.25, 0.5, 0.6, 0.75, 1, 1.5, 2];
  const display = fitMode === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`;
  return (
    <div style={{ position: "relative" }}>
      <details style={{ position: "relative" }}>
        <summary
          aria-label={`Zoom (${display})`}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
          style={{
            listStyle: "none",
            cursor: "pointer",
            height: 40,
            padding: "0 12px",
            display: "flex",
            alignItems: "center",
            gap: 4,
            color: "var(--ink)",
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 12,
          }}
        >
          {display}
          <ChevronDown size={14} style={{ opacity: 0.6 }} />
        </summary>
        <div
          style={{
            position: "absolute",
            bottom: 48,
            right: 0,
            background: "var(--menu-bg)",
            border: "1px solid var(--border-strong)",
            borderRadius: 10,
            padding: 6,
            minWidth: 130,
            boxShadow: "var(--menu-shadow)",
            color: "var(--ink)",
            zIndex: 50,
          }}
        >
          <ZoomItem label="Fit" onClick={onFit} />
          {presets.map((p) => (
            <ZoomItem
              key={p}
              label={`${Math.round(p * 100)}%`}
              onClick={() => onChange(p)}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function ZoomItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "6px 10px",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        borderRadius: 6,
        fontSize: 13,
        color: "var(--ink)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </button>
  );
}
