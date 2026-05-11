import type { CSSProperties, ReactNode } from "react";
import { Redo2 } from "lucide-react";
import { useEditor } from "@/lib/StoreProvider";
import { useIcons } from "../IconContext";
import { useReadOnly } from "../ReadOnlyContext";
import { useLabels } from "../LabelsContext";
import { iconBtnStyle, hoverHandlers } from "./styles";

/**
 * Redo button. Calls `store.redo()`. Hidden in read-only mode. Disables
 * itself when the redo stack is empty.
 */
export interface TopBarRedoProps {
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  children?: ReactNode;
}

export function Redo({
  className,
  style,
  ariaLabel,
  children,
}: TopBarRedoProps = {}) {
  const redo = useEditor((s) => s.redo);
  const canRedo = useEditor((s) => s.future.length > 0);
  const icons = useIcons();
  const readOnly = useReadOnly();
  const labels = useLabels();
  const resolvedAria = ariaLabel ?? labels.redo;
  if (readOnly) return null;

  return (
    <button
      type="button"
      className={className}
      title={resolvedAria}
      aria-label={resolvedAria}
      disabled={!canRedo}
      onClick={redo}
      style={{
        ...iconBtnStyle(),
        cursor: canRedo ? "pointer" : "default",
        opacity: canRedo ? 1 : 0.4,
        ...style,
      }}
      {...hoverHandlers()}
    >
      {children ?? icons.redo ?? <Redo2 size={16} />}
    </button>
  );
}
