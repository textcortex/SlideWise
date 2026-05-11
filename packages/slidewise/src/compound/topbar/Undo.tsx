import type { CSSProperties, ReactNode } from "react";
import { Undo2 } from "lucide-react";
import { useEditor } from "@/lib/StoreProvider";
import { useIcons } from "../IconContext";
import { useReadOnly } from "../ReadOnlyContext";
import { useLabels } from "../LabelsContext";
import { iconBtnStyle, hoverHandlers } from "./styles";

/**
 * Undo button. Calls `store.undo()`. Hidden in read-only mode. Disables
 * itself when the undo stack is empty.
 *
 * Hosts replace this when they need a different shape (e.g. their own
 * tooltip primitive or icon set with custom layout). The hook + store
 * action are public, so a host replacement is trivially:
 *
 * ```tsx
 * const MyUndo = () => {
 *   const undo = useEditor(s => s.undo);
 *   const canUndo = useEditor(s => s.history.length > 0);
 *   return <MyIconButton disabled={!canUndo} onClick={undo}>↶</MyIconButton>;
 * };
 * ```
 */
export interface TopBarUndoProps {
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  children?: ReactNode;
}

export function Undo({
  className,
  style,
  ariaLabel,
  children,
}: TopBarUndoProps = {}) {
  const undo = useEditor((s) => s.undo);
  const canUndo = useEditor((s) => s.history.length > 0);
  const icons = useIcons();
  const readOnly = useReadOnly();
  const labels = useLabels();
  const resolvedAria = ariaLabel ?? labels.undo;
  if (readOnly) return null;

  return (
    <button
      type="button"
      className={className}
      title={resolvedAria}
      aria-label={resolvedAria}
      disabled={!canUndo}
      onClick={undo}
      style={{
        ...iconBtnStyle(),
        cursor: canUndo ? "pointer" : "default",
        opacity: canUndo ? 1 : 0.4,
        ...style,
      }}
      {...hoverHandlers()}
    >
      {children ?? icons.undo ?? <Undo2 size={16} />}
    </button>
  );
}
