import type { CSSProperties, ReactNode } from "react";
import { Download } from "lucide-react";
import { useEditorStore } from "@/lib/StoreProvider";
import { useHostCallbacks } from "../HostContext";
import { useIcons } from "../IconContext";
import { useLabels } from "../LabelsContext";
import { primaryBtnStyle, primaryHoverHandlers } from "./styles";

/**
 * Export button. Calls the host's `onExport` (from `<Slidewise.Root
 * onExport>`) with the current deck. If no host callback is registered,
 * falls back to downloading a `.slidewise.json` of the deck.
 *
 * Visually emphasized vs the chrome buttons — uses `--primary-bg` so hosts
 * retheming the primary surface get a consistent affordance.
 */
export interface TopBarExportProps {
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  label?: string;
  children?: ReactNode;
}

export function Export({
  className,
  style,
  ariaLabel,
  label,
  children,
}: TopBarExportProps = {}) {
  const store = useEditorStore();
  const { onExport: onExportHost } = useHostCallbacks();
  const icons = useIcons();
  const labels = useLabels();
  const resolved = label ?? labels.export;

  const onClick = () => {
    const deck = store.getState().deck;
    if (onExportHost) {
      onExportHost(deck);
      return;
    }
    const blob = new Blob([JSON.stringify(deck, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(deck.title || "deck").replace(/[^a-z0-9-_]+/gi, "-")}.slidewise.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel ?? resolved}
      onClick={onClick}
      style={{ ...primaryBtnStyle(), ...style }}
      {...primaryHoverHandlers()}
    >
      {children ?? icons.export ?? <Download size={14} />}
      {resolved}
    </button>
  );
}
