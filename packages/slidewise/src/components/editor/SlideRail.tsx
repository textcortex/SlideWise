import { Plus, LayoutGrid, Trash2 } from "lucide-react";
import { useState } from "react";
import { useEditor } from "@/lib/StoreProvider";
import { SlideView } from "./SlideView";
import { SLIDE_W, type Slide } from "@/lib/types";

const RAIL_W = 168;
const THUMB_W = 132;
const THUMB_SCALE = THUMB_W / SLIDE_W;

export function SlideRail() {
  const slides = useEditor((s) => s.deck.slides);
  const currentId = useEditor((s) => s.currentSlideId);
  const selectSlide = useEditor((s) => s.selectSlide);
  const addSlide = useEditor((s) => s.addSlide);
  const deleteSlide = useEditor((s) => s.deleteSlide);
  const setView = useEditor((s) => s.setView);

  return (
    <div
      style={{
        width: RAIL_W,
        flexShrink: 0,
        background: "var(--rail-bg)",
        borderRight: "1px solid var(--border)",
        boxShadow: "var(--rail-shadow)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, system-ui, sans-serif",
        overflow: "hidden",
        zIndex: 5,
      }}
    >
      <div
        style={{
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          fontSize: 12,
          color: "var(--ink-muted)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <button
          title="Slide overview"
          aria-label="Open slide overview"
          onClick={() => setView("grid")}
          style={{
            width: 28,
            height: 28,
            border: "none",
            borderRadius: 6,
            background: "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ink)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--hover-strong)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <LayoutGrid size={14} />
        </button>
        <span>
          {slides.findIndex((s) => s.id === currentId) + 1} / {slides.length}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 0",
        }}
      >
        {slides.map((s, i) => (
          <ThumbRow
            key={s.id}
            index={i}
            isCurrent={s.id === currentId}
            slide={s}
            onSelect={() => selectSlide(s.id)}
            onInsertAfter={() => addSlide(s.id)}
            onDelete={() => deleteSlide(s.id)}
            isLast={i === slides.length - 1}
          />
        ))}
      </div>

      <button
        onClick={() => addSlide()}
        style={{
          height: 44,
          margin: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          background: "var(--app-bg)",
          border: "1px dashed var(--border-dashed)",
          borderRadius: 10,
          color: "var(--ink)",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          transition:
            "background 120ms, border-color 120ms, color 120ms",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--accent)";
          e.currentTarget.style.color = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--border-dashed)";
          e.currentTarget.style.color = "var(--ink)";
        }}
      >
        <Plus size={14} />
        New Slide
      </button>
    </div>
  );
}

function ThumbRow({
  index,
  isCurrent,
  slide,
  onSelect,
  onInsertAfter,
  onDelete,
  isLast,
}: {
  index: number;
  isCurrent: boolean;
  slide: Slide;
  onSelect: () => void;
  onInsertAfter: () => void;
  onDelete: () => void;
  isLast: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        padding: "0 12px",
        marginBottom: 14,
      }}
    >
      <div style={{ position: "relative" }}>
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 8,
            top: 6,
            zIndex: 2,
            width: 22,
            height: 22,
            borderRadius: 5,
            background: isCurrent ? "var(--ink)" : "#6B7280",
            color: isCurrent ? "var(--app-bg)" : "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            fontFamily: "Inter, system-ui, sans-serif",
            pointerEvents: "none",
          }}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <button
          aria-label={`Open slide ${index + 1}`}
          aria-current={isCurrent ? "true" : undefined}
          onClick={onSelect}
          style={{
            display: "block",
            width: THUMB_W,
            border: isCurrent
              ? "2px solid var(--accent)"
              : "2px solid transparent",
            borderRadius: 8,
            padding: 0,
            background: "transparent",
            cursor: "pointer",
            overflow: "hidden",
            transition: "border-color 120ms",
          }}
        >
          <div style={{ pointerEvents: "none" }}>
            <SlideView slide={slide} scale={THUMB_SCALE} />
          </div>
        </button>

        {hover && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete slide"
            aria-label={`Delete slide ${index + 1}`}
            style={{
              position: "absolute",
              right: 6,
              top: 6,
              width: 22,
              height: 22,
              borderRadius: 6,
              background: "var(--toolbar-bg)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              border: "1px solid var(--border-strong)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink)",
            }}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>

      {!isLast && <InsertGap onInsert={onInsertAfter} />}
    </div>
  );
}

function InsertGap({ onInsert }: { onInsert: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: -14,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 5,
      }}
    >
      <button
        onClick={onInsert}
        aria-label="Insert slide here"
        title="Insert slide"
        style={{
          width: hover ? 30 : 22,
          height: hover ? 30 : 22,
          borderRadius: 999,
          background: "var(--gap-icon-bg)",
          border: "1px solid var(--border-strong)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink)",
          opacity: hover ? 1 : 0,
          transform: hover ? "scale(1)" : "scale(0.85)",
          transition:
            "opacity 140ms, transform 140ms, width 140ms, height 140ms",
          boxShadow: hover ? "var(--toolbar-shadow)" : "var(--thumb-shadow)",
        }}
      >
        <Plus size={hover ? 16 : 12} />
      </button>
    </div>
  );
}
