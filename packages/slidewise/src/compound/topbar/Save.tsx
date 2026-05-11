import { useState, type CSSProperties, type ReactNode } from "react";
import { Save as SaveIcon } from "lucide-react";
import { useEditorStore } from "@/lib/StoreProvider";
import { useHostCallbacks } from "../HostContext";
import { useIcons } from "../IconContext";
import { useReadOnly } from "../ReadOnlyContext";
import { chromeBtnStyle, hoverHandlers } from "./styles";

/**
 * Save button. Calls the host's `onSave` (from `<Slidewise.Root onSave>`)
 * with the current deck. If no host callback is registered, falls back to
 * `localStorage.setItem("slidewise-deck", ...)` so the dev shell works
 * without wiring.
 *
 * Cycles through idle → saving → saved labels around the click; hosts that
 * want their own loading affordance render their own button using
 * `useHostCallbacks().onSave` directly.
 */
export interface TopBarSaveProps {
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  labels?: { idle?: string; saving?: string; saved?: string };
  children?: ReactNode;
}

export function Save({
  className,
  style,
  ariaLabel = "Save",
  labels,
  children,
}: TopBarSaveProps = {}) {
  const store = useEditorStore();
  const { onSave: onSaveHost } = useHostCallbacks();
  const icons = useIcons();
  const readOnly = useReadOnly();
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");

  if (readOnly) return null;

  const onClick = async () => {
    setPhase("saving");
    const deck = store.getState().deck;
    try {
      if (onSaveHost) {
        await onSaveHost(deck);
      } else {
        try {
          localStorage.setItem("slidewise-deck", JSON.stringify(deck));
        } catch {}
      }
      setTimeout(() => setPhase("saved"), 320);
      setTimeout(() => setPhase("idle"), 1600);
    } catch {
      setPhase("idle");
    }
  };

  const text =
    phase === "saving"
      ? (labels?.saving ?? "Saving…")
      : phase === "saved"
        ? (labels?.saved ?? "Saved")
        : (labels?.idle ?? "Save");

  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      onClick={onClick}
      style={{ ...chromeBtnStyle(), ...style }}
      {...hoverHandlers()}
    >
      {children ?? icons.save ?? <SaveIcon size={14} />}
      {text}
    </button>
  );
}
