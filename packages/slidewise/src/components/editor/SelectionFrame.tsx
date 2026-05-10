import { useRef } from "react";
import type { SlideElement } from "@/lib/types";

type Handle =
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw"
  | "rotate";

export function SelectionFrame({
  el,
  scale,
  editing = false,
  onChange,
  onCommitStart,
}: {
  el: SlideElement;
  scale: number;
  editing?: boolean;
  onChange: (patch: Partial<SlideElement>) => void;
  onCommitStart: () => void;
}) {
  const startedRef = useRef(false);

  function startDrag(handle: Handle, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!startedRef.current) {
      onCommitStart();
      startedRef.current = true;
    }
    const start = { x: e.clientX, y: e.clientY };
    const orig = { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation };
    const centerScreen = {
      x: (e.target as HTMLElement)
        .closest("[data-selection]")!
        .getBoundingClientRect().left,
      y: (e.target as HTMLElement)
        .closest("[data-selection]")!
        .getBoundingClientRect().top,
    };
    const sel = (e.target as HTMLElement).closest("[data-selection]") as HTMLElement;
    const selRect = sel.getBoundingClientRect();
    const cxScreen = selRect.left + selRect.width / 2;
    const cyScreen = selRect.top + selRect.height / 2;
    void centerScreen;

    function move(ev: MouseEvent) {
      const dx = (ev.clientX - start.x) / scale;
      const dy = (ev.clientY - start.y) / scale;
      if (handle === "rotate") {
        const angle =
          (Math.atan2(ev.clientY - cyScreen, ev.clientX - cxScreen) * 180) /
          Math.PI;
        onChange({ rotation: Math.round(angle + 90) });
        return;
      }
      let x = orig.x;
      let y = orig.y;
      let w = orig.w;
      let h = orig.h;
      if (handle.includes("e")) w = Math.max(8, orig.w + dx);
      if (handle.includes("s")) h = Math.max(8, orig.h + dy);
      if (handle.includes("w")) {
        w = Math.max(8, orig.w - dx);
        x = orig.x + (orig.w - w);
      }
      if (handle.includes("n")) {
        h = Math.max(8, orig.h - dy);
        y = orig.y + (orig.h - h);
      }
      onChange({
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
      });
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      startedRef.current = false;
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  const left = el.x * scale;
  const top = el.y * scale;
  const w = el.w * scale;
  const h = el.h * scale;
  const handleSize = 10;

  const handleStyle = (cursor: string): React.CSSProperties => ({
    position: "absolute",
    width: handleSize,
    height: handleSize,
    background: "var(--app-bg)",
    border: "1.5px solid var(--accent)",
    borderRadius: 2,
    cursor,
    boxShadow: "0 1px 3px rgba(15,23,42,0.2)",
  });

  return (
    <div
      data-selection
      style={{
        position: "absolute",
        left,
        top,
        width: w,
        height: h,
        transform: `rotate(${el.rotation}deg)`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: -2,
          border: editing
            ? "2px dashed var(--accent)"
            : "2px solid var(--accent)",
          borderRadius: 2,
          boxShadow: "0 0 0 1px rgba(255,255,255,0.6) inset",
          pointerEvents: "none",
        }}
      />

      {/* corners */}
      <div
        onMouseDown={(e) => startDrag("nw", e)}
        style={{
          ...handleStyle("nwse-resize"),
          left: -handleSize / 2,
          top: -handleSize / 2,
          pointerEvents: "auto",
        }}
      />
      <div
        onMouseDown={(e) => startDrag("ne", e)}
        style={{
          ...handleStyle("nesw-resize"),
          right: -handleSize / 2,
          top: -handleSize / 2,
          pointerEvents: "auto",
        }}
      />
      <div
        onMouseDown={(e) => startDrag("sw", e)}
        style={{
          ...handleStyle("nesw-resize"),
          left: -handleSize / 2,
          bottom: -handleSize / 2,
          pointerEvents: "auto",
        }}
      />
      <div
        onMouseDown={(e) => startDrag("se", e)}
        style={{
          ...handleStyle("nwse-resize"),
          right: -handleSize / 2,
          bottom: -handleSize / 2,
          pointerEvents: "auto",
        }}
      />
      {/* edges */}
      <div
        onMouseDown={(e) => startDrag("n", e)}
        style={{
          ...handleStyle("ns-resize"),
          left: "50%",
          top: -handleSize / 2,
          transform: "translateX(-50%)",
          pointerEvents: "auto",
        }}
      />
      <div
        onMouseDown={(e) => startDrag("s", e)}
        style={{
          ...handleStyle("ns-resize"),
          left: "50%",
          bottom: -handleSize / 2,
          transform: "translateX(-50%)",
          pointerEvents: "auto",
        }}
      />
      <div
        onMouseDown={(e) => startDrag("w", e)}
        style={{
          ...handleStyle("ew-resize"),
          left: -handleSize / 2,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "auto",
        }}
      />
      <div
        onMouseDown={(e) => startDrag("e", e)}
        style={{
          ...handleStyle("ew-resize"),
          right: -handleSize / 2,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "auto",
        }}
      />
      {/* rotate */}
      <div
        onMouseDown={(e) => startDrag("rotate", e)}
        style={{
          position: "absolute",
          left: "50%",
          top: -28,
          transform: "translateX(-50%)",
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "var(--app-bg)",
          border: "1.5px solid var(--accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--accent)",
          fontSize: 10,
          cursor: "grab",
          pointerEvents: "auto",
          boxShadow: "var(--thumb-shadow)",
        }}
      >
        ↻
      </div>
    </div>
  );
}
