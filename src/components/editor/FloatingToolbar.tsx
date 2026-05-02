import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ChevronDown,
  Layers,
  Sigma,
  ArrowUpToLine,
  ArrowDownToLine,
  AlignVerticalJustifyCenter,
} from "lucide-react";
import type { SlideElement } from "@/lib/types";
import { useEditor } from "@/lib/StoreProvider";

const FONTS = [
  "Inter",
  "Coda",
  "Geist",
  "JetBrains Mono",
  "Georgia",
  "Helvetica",
  "system-ui",
];

const COLORS = [
  "#0E1330",
  "#FFFFFF",
  "#4F5BD5",
  "#E8504C",
  "#F2B544",
  "#3DB270",
  "#9CA3AF",
];

const MATH_SYMBOLS = [
  { glyph: "∑", label: "Sum" },
  { glyph: "∏", label: "Product" },
  { glyph: "∫", label: "Integral" },
  { glyph: "√", label: "Sqrt" },
  { glyph: "π", label: "Pi" },
  { glyph: "∞", label: "Infinity" },
  { glyph: "≈", label: "Approx" },
  { glyph: "≠", label: "Not equal" },
  { glyph: "≤", label: "Less or eq" },
  { glyph: "≥", label: "Greater or eq" },
  { glyph: "→", label: "Arrow" },
  { glyph: "±", label: "Plus minus" },
  { glyph: "Δ", label: "Delta" },
  { glyph: "λ", label: "Lambda" },
];

export function FloatingToolbar({
  element,
  scale,
  surfaceRef,
}: {
  element: SlideElement;
  scale: number;
  surfaceRef: React.RefObject<HTMLDivElement | null>;
}) {
  const updateElement = useEditor((s) => s.updateElement);
  const bringForward = useEditor((s) => s.bringForward);
  const sendBackward = useEditor((s) => s.sendBackward);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const update = () => {
      if (!surfaceRef.current) return;
      const surf = surfaceRef.current.getBoundingClientRect();
      const parent = surfaceRef.current.parentElement!.getBoundingClientRect();
      const left =
        surf.left - parent.left + (element.x + element.w / 2) * scale;
      const top = surf.top - parent.top + element.y * scale - 56;
      setPos({ left, top: Math.max(8, top) });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [element, scale, surfaceRef]);

  if (!pos) return null;

  const isText = element.type === "text";
  const isShape = element.type === "shape";
  const isImage = element.type === "image";
  const isLine = element.type === "line";

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        left: pos.left,
        top: pos.top,
        transform: "translateX(-50%)",
        zIndex: 30,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: 6,
          background: "var(--toolbar-bg)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "var(--toolbar-shadow)",
          fontSize: 13,
          color: "var(--ink)",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {isText && (
          <>
            <ColorBtn
              label="Text color"
              value={element.color}
              onChange={(c) => updateElement(element.id, { color: c })}
            />
            <Sep />
            <Select
              label="Font family"
              value={element.fontFamily}
              onChange={(v) => updateElement(element.id, { fontFamily: v })}
              options={FONTS}
              width={108}
            />
            <Sep />
            <NumberInput
              label="Font size"
              value={element.fontSize}
              onChange={(v) => updateElement(element.id, { fontSize: v })}
              suffix="px"
              width={66}
            />
            <Sep />
            <Toggle
              label="Bold"
              active={element.fontWeight >= 700}
              onClick={() =>
                updateElement(element.id, {
                  fontWeight: element.fontWeight >= 700 ? 400 : 700,
                })
              }
            >
              <Bold size={15} />
            </Toggle>
            <Toggle
              label="Italic"
              active={element.italic}
              onClick={() =>
                updateElement(element.id, { italic: !element.italic })
              }
            >
              <Italic size={15} />
            </Toggle>
            <Toggle
              label="Underline"
              active={element.underline}
              onClick={() =>
                updateElement(element.id, { underline: !element.underline })
              }
            >
              <Underline size={15} />
            </Toggle>
            <Toggle
              label="Strikethrough"
              active={element.strike}
              onClick={() =>
                updateElement(element.id, { strike: !element.strike })
              }
            >
              <Strikethrough size={15} />
            </Toggle>
            <Sep />
            <Menu
              label="Insert math symbol"
              icon={<Sigma size={15} />}
              options={MATH_SYMBOLS.map((sym) => ({
                label: `${sym.glyph}  ${sym.label}`,
                onClick: () =>
                  updateElement(element.id, {
                    text: (element.text ?? "") + sym.glyph,
                  }),
              }))}
            />
            <Menu
              label="Horizontal alignment"
              icon={
                element.align === "center" ? (
                  <AlignCenter size={15} />
                ) : element.align === "right" ? (
                  <AlignRight size={15} />
                ) : (
                  <AlignLeft size={15} />
                )
              }
              options={[
                {
                  label: "Left",
                  icon: <AlignLeft size={14} />,
                  onClick: () => updateElement(element.id, { align: "left" }),
                },
                {
                  label: "Center",
                  icon: <AlignCenter size={14} />,
                  onClick: () => updateElement(element.id, { align: "center" }),
                },
                {
                  label: "Right",
                  icon: <AlignRight size={14} />,
                  onClick: () => updateElement(element.id, { align: "right" }),
                },
              ]}
            />
            <Menu
              label="Vertical alignment"
              icon={
                element.vAlign === "middle" ? (
                  <AlignVerticalJustifyCenter size={15} />
                ) : element.vAlign === "bottom" ? (
                  <ArrowDownToLine size={15} />
                ) : (
                  <ArrowUpToLine size={15} />
                )
              }
              options={[
                {
                  label: "Top",
                  icon: <ArrowUpToLine size={14} />,
                  onClick: () => updateElement(element.id, { vAlign: "top" }),
                },
                {
                  label: "Middle",
                  icon: <AlignVerticalJustifyCenter size={14} />,
                  onClick: () =>
                    updateElement(element.id, { vAlign: "middle" }),
                },
                {
                  label: "Bottom",
                  icon: <ArrowDownToLine size={14} />,
                  onClick: () =>
                    updateElement(element.id, { vAlign: "bottom" }),
                },
              ]}
            />
            <NumberInput
              label="Line height"
              value={element.lineHeight}
              onChange={(v) => updateElement(element.id, { lineHeight: v })}
              step={0.05}
              suffix=""
              width={56}
              min={0.6}
              max={3}
            />
            <Sep />
          </>
        )}

        {isShape && (
          <>
            <ColorBtn
              label="Fill color"
              value={element.fill}
              onChange={(c) => updateElement(element.id, { fill: c })}
            />
            <Sep />
            <NumberInput
              label="Corner radius"
              value={element.radius ?? 0}
              onChange={(v) => updateElement(element.id, { radius: v })}
              suffix="r"
              width={56}
            />
            <Sep />
          </>
        )}

        {isImage && (
          <>
            <NumberInput
              label="Corner radius"
              value={element.radius ?? 0}
              onChange={(v) => updateElement(element.id, { radius: v })}
              suffix="r"
              width={56}
            />
            <Sep />
          </>
        )}

        {isLine && (
          <>
            <ColorBtn
              label="Stroke color"
              value={element.stroke}
              onChange={(c) => updateElement(element.id, { stroke: c })}
            />
            <NumberInput
              label="Stroke width"
              value={element.strokeWidth}
              onChange={(v) => updateElement(element.id, { strokeWidth: v })}
              suffix="w"
              width={56}
            />
            <Sep />
          </>
        )}

        <Menu
          label="Layer order"
          icon={<Layers size={15} />}
          options={[
            {
              label: "Bring forward",
              onClick: () => bringForward(element.id),
            },
            {
              label: "Send backward",
              onClick: () => sendBackward(element.id),
            },
          ]}
        />
      </div>
    </div>
  );
}

function Sep() {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 1,
        height: 18,
        background: "var(--border)",
        margin: "0 2px",
      }}
    />
  );
}

function Toggle({
  active,
  children,
  onClick,
  label,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={!!active}
      style={{
        height: 28,
        minWidth: 28,
        padding: "0 6px",
        background: active ? "var(--active)" : "transparent",
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ink)",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = active
          ? "var(--active)"
          : "var(--hover)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = active
          ? "var(--active)"
          : "transparent")
      }
    >
      {children}
    </button>
  );
}

function NumberInput({
  value,
  onChange,
  width = 64,
  suffix,
  step = 1,
  min,
  max,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  width?: number;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  label: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 28,
        padding: "0 8px",
        background: "var(--input-bg)",
        borderRadius: 8,
        width,
        gap: 4,
      }}
    >
      <input
        type="number"
        aria-label={label}
        title={label}
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          fontSize: 13,
          color: "var(--ink)",
          fontFamily: "inherit",
        }}
      />
      {suffix && (
        <span style={{ fontSize: 11, color: "var(--ink-muted)" }}>{suffix}</span>
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  width = 100,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  width?: number;
  label: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        height: 28,
        background: "var(--input-bg)",
        borderRadius: 8,
        width,
        display: "flex",
        alignItems: "center",
        padding: "0 8px",
        gap: 4,
      }}
    >
      <select
        aria-label={label}
        title={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: "none",
          width: "100%",
          background: "transparent",
          border: "none",
          fontSize: 13,
          color: "var(--ink)",
          fontFamily: "inherit",
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        style={{ color: "var(--ink-muted)", pointerEvents: "none" }}
      />
    </div>
  );
}

function ColorBtn({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          height: 28,
          padding: "0 8px",
          background: "transparent",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "var(--ink)",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--hover-strong)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            background: value,
            border: "1px solid var(--border-strong)",
          }}
        />
        <span style={{ fontSize: 11, fontWeight: 700 }}>A</span>
        <ChevronDown size={11} style={{ opacity: 0.5 }} />
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
          />
          <div
            style={{
              position: "absolute",
              top: 32,
              left: 0,
              background: "var(--menu-bg)",
              border: "1px solid var(--border-strong)",
              borderRadius: 12,
              padding: 10,
              boxShadow: "var(--menu-shadow)",
              zIndex: 41,
              display: "grid",
              gridTemplateColumns: "repeat(7, 22px)",
              gap: 6,
            }}
          >
            {COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Set color ${c}`}
                aria-pressed={c === value}
                title={c}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: c,
                  border:
                    c === value
                      ? "2px solid var(--accent)"
                      : "1px solid var(--border-strong)",
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            ))}
            <input
              type="color"
              aria-label="Pick custom color"
              title="Pick custom color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              style={{
                gridColumn: "span 7",
                marginTop: 4,
                width: "100%",
                height: 28,
                border: "none",
                background: "transparent",
                cursor: "pointer",
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Menu({
  icon,
  options,
  label,
}: {
  icon: React.ReactNode;
  options: { label: string; icon?: React.ReactNode; onClick: () => void }[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          height: 28,
          padding: "0 8px",
          background: "transparent",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 2,
          color: "var(--ink)",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--hover-strong)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {icon}
        <ChevronDown size={11} style={{ opacity: 0.5, marginLeft: 2 }} />
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
          />
          <div
            style={{
              position: "absolute",
              top: 32,
              left: 0,
              background: "var(--menu-bg)",
              border: "1px solid var(--border-strong)",
              borderRadius: 10,
              padding: 6,
              boxShadow: "var(--menu-shadow)",
              zIndex: 41,
              minWidth: 160,
              color: "var(--ink)",
            }}
          >
            {options.map((o) => (
              <button
                key={o.label}
                onClick={() => {
                  o.onClick();
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  borderRadius: 6,
                  fontSize: 13,
                  color: "var(--ink)",
                  textAlign: "left",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                {o.icon}
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
