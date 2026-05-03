import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditor, useEditorStore } from "@/lib/StoreProvider";
import type { Tool } from "@/lib/store";
import { SLIDE_W, SLIDE_H, type SlideElement, type ElementDraft } from "@/lib/types";
import { ElementView } from "./ElementView";
import { SelectionFrame } from "./SelectionFrame";
import { FloatingToolbar } from "./FloatingToolbar";

export function Canvas() {
  const store = useEditorStore();
  const slide = useEditor((s) => s.currentSlide());
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const zoom = useEditor((s) => s.zoom);
  const fitMode = useEditor((s) => s.fitMode);
  const setZoom = useEditor((s) => s.setZoom);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectElement = useEditor((s) => s.selectElement);
  const clearSelection = useEditor((s) => s.clearSelection);
  const addElement = useEditor((s) => s.addElement);
  const updateElement = useEditor((s) => s.updateElement);
  const deleteElement = useEditor((s) => s.deleteElement);
  const pushHistory = useEditor((s) => s.pushHistory);

  const [editingId, setEditingId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [autoScale, setAutoScale] = useState(0.6);

  useLayoutEffect(() => {
    if (fitMode !== "fit" || !wrapRef.current) return;
    const recompute = () => {
      const r = wrapRef.current!.getBoundingClientRect();
      // Generous fill: small breathing room horizontally, plus enough vertical
      // headroom for the floating toolbar (~56) and the bottom toolbar (~76).
      const padX = 32;
      const padY = 56 + 76 + 16;
      const fit = Math.min(
        (r.width - padX) / SLIDE_W,
        (r.height - padY) / SLIDE_H
      );
      setAutoScale(Math.max(0.05, fit));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [fitMode]);

  const scale = fitMode === "fit" ? autoScale : zoom;

  // keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editingId) return;
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA"))
        return;
      if ((e.key === "Backspace" || e.key === "Delete") && selectedIds.length) {
        e.preventDefault();
        selectedIds.forEach(deleteElement);
      }
      if (e.key === "Escape") clearSelection();
      if (e.key === "Enter" && selectedIds.length === 1) {
        const el = slide.elements.find((x) => x.id === selectedIds[0]);
        if (el && el.type === "text") {
          e.preventDefault();
          setEditingId(el.id);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        store.getState().undo();
      }
      if (
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && e.shiftKey) ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y")
      ) {
        e.preventDefault();
        store.getState().redo();
      }
      if (selectedIds.length) {
        const step = e.shiftKey ? 16 : 2;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          selectedIds.forEach((id) => {
            const el = slide.elements.find((x) => x.id === id);
            if (!el) return;
            const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
            const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
            updateElement(id, { x: el.x + dx, y: el.y + dy });
          });
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    editingId,
    selectedIds,
    deleteElement,
    clearSelection,
    slide.elements,
    updateElement,
    store,
  ]);

  // wheel zoom (cmd/ctrl)
  function handleWheel(e: React.WheelEvent) {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const next = scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08);
      setZoom(next);
    }
  }

  function clientToSlide(clientX: number, clientY: number) {
    const r = surfaceRef.current!.getBoundingClientRect();
    return {
      x: (clientX - r.left) / scale,
      y: (clientY - r.top) / scale,
    };
  }

  const surfaceRef = useRef<HTMLDivElement>(null);

  // create-on-drag for shape/text/line/etc.
  const [draftRect, setDraftRect] = useState<
    | null
    | { x: number; y: number; w: number; h: number; type: typeof tool }
  >(null);

  function startCreate(e: React.MouseEvent) {
    if (tool === "select") return;
    const start = clientToSlide(e.clientX, e.clientY);
    setDraftRect({ x: start.x, y: start.y, w: 1, h: 1, type: tool });
    const move = (ev: MouseEvent) => {
      const cur = clientToSlide(ev.clientX, ev.clientY);
      setDraftRect({
        x: Math.min(start.x, cur.x),
        y: Math.min(start.y, cur.y),
        w: Math.abs(cur.x - start.x),
        h: Math.abs(cur.y - start.y),
        type: tool,
      });
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const cur = clientToSlide(ev.clientX, ev.clientY);
      let w = Math.abs(cur.x - start.x);
      let h = Math.abs(cur.y - start.y);
      const x = Math.min(start.x, cur.x);
      const y = Math.min(start.y, cur.y);
      if (w < 8 && h < 8) {
        w = defaultSize(tool).w;
        h = defaultSize(tool).h;
      }
      const created = createDefault(tool, x, y, w, h);
      const wasText = tool === "text" || tool === "formula";
      if (created) {
        const newId = addElement(created);
        if (wasText) setEditingId(newId);
      }
      setDraftRect(null);
      setTool("select");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function onElementDown(e: React.MouseEvent, el: SlideElement) {
    if (tool !== "select") return;
    if (editingId === el.id) return;
    e.stopPropagation();
    if (!selectedIds.includes(el.id)) {
      selectElement(el.id, e.shiftKey);
    }

    const start = { x: e.clientX, y: e.clientY };
    const snapshot = store.getState();
    const orig = snapshot.currentSlide().elements.filter((x) =>
      snapshot.selectedIds.concat(el.id).includes(x.id)
    );
    const ids = Array.from(new Set([el.id, ...snapshot.selectedIds]));

    let dragStarted = false;
    const DRAG_THRESHOLD = 4;

    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!dragStarted && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        dragStarted = true;
        pushHistory();
      }
      if (!dragStarted) return;
      ids.forEach((id) => {
        const o = orig.find((x) => x.id === id);
        if (!o) return;
        updateElement(id, {
          x: Math.round(o.x + dx / scale),
          y: Math.round(o.y + dy / scale),
        });
      });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (!dragStarted && el.type === "text" && !e.shiftKey) {
        setEditingId(el.id);
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <div
      ref={wrapRef}
      onWheel={handleWheel}
      style={{
        flex: 1,
        position: "relative",
        overflow: "hidden",
        background:
          "radial-gradient(circle at 50% 30%, var(--canvas-bg-from) 0%, var(--canvas-bg-to) 100%)",
        cursor: tool !== "select" ? "crosshair" : "default",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) clearSelection();
      }}
    >
      <div
        ref={surfaceRef}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            clearSelection();
            startCreate(e);
          }
        }}
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: SLIDE_W * scale,
          height: SLIDE_H * scale,
          transform: "translate(-50%, -50%)",
          background: slide.background,
          borderRadius: 8,
          boxShadow: "var(--slide-shadow)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            width: SLIDE_W,
            height: SLIDE_H,
          }}
        >
          {[...slide.elements]
            .sort((a, b) => a.z - b.z)
            .map((el) => {
              return (
                <div
                  key={el.id}
                  onMouseDown={(e) => onElementDown(e, el)}
                  onDoubleClick={() => {
                    if (el.type === "text") setEditingId(el.id);
                  }}
                  style={{
                    position: "absolute",
                    left: el.x,
                    top: el.y,
                    width: el.w,
                    height: el.h,
                    transform: `rotate(${el.rotation}deg)`,
                    cursor: tool === "select" ? "move" : "crosshair",
                  }}
                >
                  <ElementView
                    el={el}
                    editing={editingId === el.id && el.type === "text"}
                    onTextCommit={(text, runs) => {
                      if (el.type === "text") {
                        // The contentEditable surface preserves run styles
                        // when the user only edits text within them. If the
                        // editor returned undefined runs (homogeneous style),
                        // fall back to the flat representation.
                        updateElement(el.id, { text, runs });
                      }
                      setEditingId(null);
                    }}
                  />
                </div>
              );
            })}

          {draftRect && (
            <div
              style={{
                position: "absolute",
                left: draftRect.x,
                top: draftRect.y,
                width: draftRect.w,
                height: draftRect.h,
                border: "2px dashed var(--accent)",
                background: "var(--accent-soft)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>

        {selectedIds.map((id) => {
          const el = slide.elements.find((e) => e.id === id);
          if (!el) return null;
          return (
            <SelectionFrame
              key={id}
              el={el}
              scale={scale}
              editing={editingId === id}
              onChange={(patch) => updateElement(id, patch)}
              onCommitStart={() => pushHistory()}
            />
          );
        })}
      </div>

      {selectedIds.length === 1 && (
        <FloatingToolbar
          element={slide.elements.find((e) => e.id === selectedIds[0])!}
          scale={scale}
          surfaceRef={surfaceRef}
        />
      )}
    </div>
  );
}

function defaultSize(t: Tool) {
  switch (t) {
    case "text":
      return { w: 600, h: 100 };
    case "line":
      return { w: 400, h: 4 };
    case "image":
      return { w: 600, h: 400 };
    case "table":
      return { w: 800, h: 300 };
    case "icon":
      return { w: 120, h: 120 };
    case "embed":
      return { w: 600, h: 360 };
    default:
      return { w: 300, h: 200 };
  }
}

function createDefault(
  tool: Tool,
  x: number,
  y: number,
  w: number,
  h: number
): ElementDraft | null {
  const base = {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    rotation: 0,
  };
  switch (tool) {
    case "shape":
      return {
        ...base,
        type: "shape",
        shape: "rounded",
        fill: "#4F5BD5",
        radius: 16,
      };
    case "text":
      return {
        ...base,
        type: "text",
        text: "Type something",
        fontFamily: "Inter",
        fontSize: 48,
        fontWeight: 600,
        italic: false,
        underline: false,
        strike: false,
        color: "#0E1330",
        align: "left",
        vAlign: "top",
        lineHeight: 1.2,
        letterSpacing: 0,
      };
    case "line":
      return {
        ...base,
        h: Math.max(2, base.h),
        type: "line",
        stroke: "#0E1330",
        strokeWidth: 4,
      };
    case "image":
      return {
        ...base,
        type: "image",
        src: "https://images.unsplash.com/photo-1517292987719-0369a794ec0f?auto=format&fit=crop&w=1200&q=70",
        fit: "cover",
        radius: 12,
      };
    case "table":
      return {
        ...base,
        type: "table",
        rows: [
          ["Header A", "Header B", "Header C"],
          ["Item 1", "Item 2", "Item 3"],
          ["Item 4", "Item 5", "Item 6"],
        ],
        headerFill: "#D7DBE2",
        rowFill: "#EBEDF1",
        textColor: "#0E1330",
        fontSize: 22,
      };
    case "icon":
      return {
        ...base,
        type: "icon",
        icon: "★",
        color: "#4F5BD5",
      };
    case "embed":
      return {
        ...base,
        type: "embed",
        url: "https://example.com",
        label: "Embed",
      };
    case "formula":
      return {
        ...base,
        type: "text",
        text: "E = mc²",
        fontFamily: "JetBrains Mono",
        fontSize: 40,
        fontWeight: 500,
        italic: false,
        underline: false,
        strike: false,
        color: "#0E1330",
        align: "left",
        vAlign: "top",
        lineHeight: 1.2,
        letterSpacing: 0,
      };
    default:
      return null;
  }
}
