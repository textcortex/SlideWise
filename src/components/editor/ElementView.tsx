import { useEffect, useRef } from "react";
import type {
  SlideElement,
  TextElement,
  ShapeElement,
  ImageElement,
  LineElement,
  TableElement,
  IconElement,
  EmbedElement,
  UnknownElement,
} from "@/lib/types";

export function ElementView({
  el,
  editing,
  onTextCommit,
}: {
  el: SlideElement;
  editing?: boolean;
  onTextCommit?: (text: string) => void;
}) {
  switch (el.type) {
    case "text":
      return <TextView el={el} editing={editing} onCommit={onTextCommit} />;
    case "shape":
      return <ShapeView el={el} />;
    case "image":
      return <ImageView el={el} />;
    case "line":
      return <LineView el={el} />;
    case "table":
      return <TableView el={el} />;
    case "icon":
      return <IconView el={el} />;
    case "embed":
      return <EmbedView el={el} />;
    case "unknown":
      return <UnknownView el={el} />;
  }
}

function TextView({
  el,
  editing,
  onCommit,
}: {
  el: TextElement;
  editing?: boolean;
  onCommit?: (text: string) => void;
}) {
  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    color: el.color,
    fontFamily: el.fontFamily,
    fontSize: el.fontSize,
    fontWeight: el.fontWeight,
    fontStyle: el.italic ? "italic" : "normal",
    textDecoration: [el.underline && "underline", el.strike && "line-through"]
      .filter(Boolean)
      .join(" "),
    textAlign: el.align,
    lineHeight: el.lineHeight,
    letterSpacing: el.letterSpacing,
    display: "flex",
    flexDirection: "column",
    justifyContent:
      el.vAlign === "top"
        ? "flex-start"
        : el.vAlign === "middle"
          ? "center"
          : "flex-end",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    outline: "none",
    cursor: editing ? "text" : "inherit",
  };

  if (editing) {
    return (
      <EditableText
        style={style}
        initial={el.text}
        onCommit={(t) => onCommit?.(t)}
      />
    );
  }

  return <div style={style}>{el.text}</div>;
}

function EditableText({
  style,
  initial,
  onCommit,
}: {
  style: React.CSSProperties;
  initial: string;
  onCommit: (t: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.innerText = initial;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      style={style}
      contentEditable
      suppressContentEditableWarning
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => onCommit(e.currentTarget.innerText)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          (e.target as HTMLDivElement).blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

function ShapeView({ el }: { el: ShapeElement }) {
  const stroke = el.stroke ?? "transparent";
  const sw = el.strokeWidth ?? 0;
  if (el.shape === "rect" || el.shape === "rounded") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: el.fill,
          borderRadius: el.shape === "rounded" ? (el.radius ?? 16) : 0,
          border: sw ? `${sw}px solid ${stroke}` : undefined,
        }}
      />
    );
  }
  if (el.shape === "circle") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: el.fill,
          borderRadius: "50%",
          border: sw ? `${sw}px solid ${stroke}` : undefined,
        }}
      />
    );
  }
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
      {el.shape === "triangle" && (
        <polygon
          points="50,3 97,97 3,97"
          fill={el.fill}
          stroke={stroke}
          strokeWidth={sw}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {el.shape === "diamond" && (
        <polygon
          points="50,3 97,50 50,97 3,50"
          fill={el.fill}
          stroke={stroke}
          strokeWidth={sw}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {el.shape === "star" && (
        <polygon
          points="50,5 61,38 96,38 67,59 78,93 50,72 22,93 33,59 4,38 39,38"
          fill={el.fill}
          stroke={stroke}
          strokeWidth={sw}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

function ImageView({ el }: { el: ImageElement }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        borderRadius: el.radius ?? 0,
        background: "#0001",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={el.src}
        alt={el.alt ?? ""}
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: el.fit,
          display: "block",
          userSelect: "none",
        }}
      />
    </div>
  );
}

function LineView({ el }: { el: LineElement }) {
  const w = Math.max(el.w, 1);
  const h = Math.max(el.h, 1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height="100%">
      <line
        x1={0}
        y1={h / 2}
        x2={w - (el.arrow ? 16 : 0)}
        y2={h / 2}
        stroke={el.stroke}
        strokeWidth={el.strokeWidth}
        strokeDasharray={el.dashed ? "12 8" : undefined}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {el.arrow && (
        <polygon
          points={`${w},${h / 2} ${w - 18},${h / 2 - 9} ${w - 18},${h / 2 + 9}`}
          fill={el.stroke}
        />
      )}
    </svg>
  );
}

function TableView({ el }: { el: TableElement }) {
  const cols = el.rows[0]?.length ?? 1;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        width: "100%",
        height: "100%",
        gap: 6,
        background: "transparent",
      }}
    >
      {el.rows.flatMap((row, ri) =>
        row.map((cell, ci) => (
          <div
            key={`${ri}-${ci}`}
            style={{
              background: ri === 0 ? el.headerFill : el.rowFill,
              color: el.textColor,
              fontSize: el.fontSize,
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              fontWeight: ri === 0 ? 600 : 500,
              borderRadius: 6,
            }}
          >
            {cell}
          </div>
        ))
      )}
    </div>
  );
}

function IconView({ el }: { el: IconElement }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: el.color,
        fontSize: Math.min(el.w, el.h) * 0.7,
      }}
    >
      {el.icon}
    </div>
  );
}

function UnknownView({ el }: { el: UnknownElement }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background:
          "repeating-linear-gradient(45deg, rgba(15,19,48,0.04) 0 8px, transparent 8px 16px)",
        border: "1px dashed var(--border-strong)",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 4,
        color: "var(--ink-muted)",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 12,
        padding: 12,
        textAlign: "center",
      }}
    >
      <div style={{ fontWeight: 600 }}>{el.label ?? "Imported content"}</div>
      <div style={{ opacity: 0.7 }}>{el.ooxmlTag}</div>
    </div>
  );
}

function EmbedView({ el }: { el: EmbedElement }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0E1330",
        color: "#fff",
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        padding: 16,
        gap: 8,
        fontFamily: "Inter",
      }}
    >
      <div style={{ fontSize: 14, opacity: 0.6 }}>Embed</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{el.label}</div>
      <div style={{ fontSize: 12, opacity: 0.5, wordBreak: "break-all" }}>
        {el.url}
      </div>
    </div>
  );
}
