import type { CSSProperties, ReactNode } from "react";
import { Download } from "lucide-react";
import { useEditorStore } from "@/lib/StoreProvider";
import { serializeDeck } from "@/lib/pptx";
import { useHostCallbacks } from "../HostContext";
import { useIcons } from "../IconContext";
import { useLabels } from "../LabelsContext";
import { primaryBtnStyle, primaryHoverHandlers } from "./styles";

/**
 * Export button. Calls the host's `onExport` (from `<Slidewise.Root
 * onExport>`) with the current deck. If no host callback is registered,
 * falls back to downloading a real `.pptx` of the deck — serializeDeck
 * resolves source bytes via the in-module cache keyed by
 * `Deck.sourcePptxId`, so master / layout / theme / font / EMF / slide-bg
 * preservation kicks in for any deck that was parsed via `parsePptx` in
 * the same session. This lets hosts verify the full edit → save round
 * trip without wiring `onExport` at all.
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

  const onClick = async () => {
    const deck = store.getState().deck;
    if (onExportHost) {
      onExportHost(deck);
      return;
    }
    let blob: Blob;
    let extension: string;
    try {
      blob = await serializeDeck(deck);
      extension = "pptx";
    } catch (err) {
      // PPTX serialization shouldn't fail on a deck the editor already
      // renders, but if pptxgenjs throws (corrupt media, unsupported
      // shape, etc.) we still want the user to get *something* off their
      // screen rather than an unrecoverable error — fall back to JSON.
      console.error("[slidewise] PPTX export failed, falling back to JSON:", err);
      blob = new Blob([JSON.stringify(deck, null, 2)], {
        type: "application/json",
      });
      extension = "slidewise.json";
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(deck.title || "deck").replace(/[^a-z0-9-_]+/gi, "-")}.${extension}`;
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
