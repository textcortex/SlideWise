import type { CSSProperties, ReactNode } from "react";
import { Plus } from "lucide-react";
import { useEditor } from "@/lib/StoreProvider";
import { useReadOnly } from "../ReadOnlyContext";
import { useLabels } from "../LabelsContext";

/**
 * Dashed "New Slide" button at the bottom of the rail. Calls
 * `store.addSlide()`. Hidden in read-only mode.
 *
 * Replace with your own button when you need a different shape; the
 * store action is exported (`useEditor((s) => s.addSlide)`).
 */
export interface SlideRailAddButtonProps {
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  /** Override the visible label. Defaults to `labels.addSlide`. */
  label?: string;
  children?: ReactNode;
}

export function AddButton({
  className,
  style,
  ariaLabel,
  label,
  children,
}: SlideRailAddButtonProps = {}) {
  const addSlide = useEditor((s) => s.addSlide);
  const readOnly = useReadOnly();
  const labels = useLabels();
  if (readOnly) return null;

  const resolved = label ?? labels.addSlide;

  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel ?? resolved}
      onClick={() => addSlide()}
      style={{
        height: 44,
        margin: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        background: "var(--slidewise-bg-app, var(--app-bg))",
        border: "1px dashed var(--border-dashed)",
        borderRadius: "var(--slidewise-radius, 10px)",
        color: "var(--ink)",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        transition: "background 120ms, border-color 120ms, color 120ms",
        fontFamily: "inherit",
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor =
          "var(--slidewise-accent, var(--accent))";
        e.currentTarget.style.color =
          "var(--slidewise-accent, var(--accent))";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border-dashed)";
        e.currentTarget.style.color = "var(--ink)";
      }}
    >
      {children ?? <Plus size={14} />}
      {resolved}
    </button>
  );
}
