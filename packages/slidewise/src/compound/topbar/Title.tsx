import type { CSSProperties } from "react";
import { Sparkles } from "lucide-react";
import { useEditor } from "@/lib/StoreProvider";
import { useIcons } from "../IconContext";
import { useReadOnly } from "../ReadOnlyContext";
import { useLabels } from "../LabelsContext";

/**
 * Deck title input wrapped in the "Smart" pill. Reads + writes
 * `deck.title` on the editor store. In read-only mode the input is locked.
 *
 * Hosts that want a different title affordance (a static label, a custom
 * input style) drop this subpart and render their own — `useEditor` is
 * exported so the host's component can read `s.deck.title` and call
 * `s.setTitle(...)`.
 */
export interface TopBarTitleProps {
  className?: string;
  style?: CSSProperties;
}

export function Title({ className, style }: TopBarTitleProps = {}) {
  const title = useEditor((s) => s.deck.title);
  const setTitle = useEditor((s) => s.setTitle);
  const icons = useIcons();
  const readOnly = useReadOnly();
  const labels = useLabels();

  return (
    <div
      className={
        className
          ? `slidewise-topbar-title ${className}`
          : "slidewise-topbar-title"
      }
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minWidth: 0,
        ...style,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          background: "var(--smart-grad)",
          color: "var(--smart-fg)",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.2,
        }}
      >
        {icons.smart ?? <Sparkles size={11} />}
        {labels.smart}
      </span>
      <input
        aria-label={labels.titleAriaLabel}
        value={title}
        readOnly={readOnly}
        onChange={(e) => setTitle(e.target.value)}
        style={{
          background: "transparent",
          border: "none",
          fontSize: 14,
          fontWeight: 500,
          color: "var(--ink)",
          textAlign: "center",
          minWidth: 240,
          maxWidth: 520,
        }}
      />
    </div>
  );
}
