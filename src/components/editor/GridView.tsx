import { useEffect } from "react";
import { Plus, X } from "lucide-react";
import { useEditor } from "@/lib/store";
import { SlideView } from "./SlideView";
import { SLIDE_W } from "@/lib/types";

const COL_GAP = 28;
const ROW_GAP = 36;
const COLS = 4;
const PAD_X = 64;

export function GridView() {
  const slides = useEditor((s) => s.deck.slides);
  const currentId = useEditor((s) => s.currentSlideId);
  const title = useEditor((s) => s.deck.title);
  const selectSlide = useEditor((s) => s.selectSlide);
  const addSlide = useEditor((s) => s.addSlide);
  const setView = useEditor((s) => s.setView);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setView("editor");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setView]);

  const thumbW =
    typeof window !== "undefined"
      ? Math.min(
          340,
          (window.innerWidth - PAD_X * 2 - COL_GAP * (COLS - 1)) / COLS
        )
      : 320;
  const scale = thumbW / SLIDE_W;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--grid-overlay-bg)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        zIndex: 80,
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 28px",
          borderBottom: "1px solid var(--border)",
          background: "var(--toolbar-bg)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            color: "var(--ink)",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {title || "Untitled deck"}
          </span>
          <span
            style={{
              fontSize: 12,
              color: "var(--ink-muted)",
              padding: "2px 8px",
              borderRadius: 999,
              background: "var(--input-bg)",
            }}
          >
            {slides.length} slide{slides.length === 1 ? "" : "s"}
          </span>
        </div>
        <button
          onClick={() => setView("editor")}
          title="Close overview (Esc)"
          aria-label="Close slide overview"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--ink)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          <X size={16} />
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: `40px ${PAD_X}px 80px`,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${COLS}, ${thumbW}px)`,
            columnGap: COL_GAP,
            rowGap: ROW_GAP,
            justifyContent: "center",
          }}
        >
          {slides.map((s, i) => {
            const isCurrent = s.id === currentId;
            return (
              <button
                key={s.id}
                aria-label={`Open slide ${i + 1}`}
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => {
                  selectSlide(s.id);
                  setView("editor");
                }}
                style={{
                  position: "relative",
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: -10,
                    top: -10,
                    zIndex: 2,
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: isCurrent ? "var(--accent)" : "var(--ink)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    boxShadow: "var(--thumb-shadow)",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div
                  style={{
                    borderRadius: 14,
                    overflow: "hidden",
                    border: isCurrent
                      ? "3px solid var(--accent)"
                      : "3px solid transparent",
                    boxShadow: "var(--slide-shadow)",
                    transition: "transform 140ms, border-color 120ms",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  <SlideView slide={s} scale={scale} />
                </div>
              </button>
            );
          })}

          <button
            onClick={() => addSlide()}
            aria-label="Add new slide"
            style={{
              width: thumbW,
              aspectRatio: `${SLIDE_W} / 1080`,
              borderRadius: 14,
              border: "2px dashed var(--border-dashed)",
              background: "transparent",
              color: "var(--ink-muted)",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 500,
              transition: "border-color 120ms, color 120ms, background 120ms",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
              e.currentTarget.style.color = "var(--accent)";
              e.currentTarget.style.background = "var(--accent-soft)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-dashed)";
              e.currentTarget.style.color = "var(--ink-muted)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Plus size={20} />
            New Slide
          </button>
        </div>
      </div>
    </div>
  );
}
