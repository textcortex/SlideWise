import type { CSSProperties, ReactNode } from "react";
import { Play as PlayIcon } from "lucide-react";
import { useEditor } from "@/lib/StoreProvider";
import { useIcons } from "../IconContext";
import { useLabels } from "../LabelsContext";
import { chromeBtnStyle, hoverHandlers } from "./styles";

/**
 * Play button. Enters slideshow / play mode. Always rendered (read-only
 * viewers should still be able to present).
 */
export interface TopBarPlayProps {
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  label?: string;
  children?: ReactNode;
}

export function Play({
  className,
  style,
  ariaLabel,
  label,
  children,
}: TopBarPlayProps = {}) {
  const play = useEditor((s) => s.play);
  const icons = useIcons();
  const labels = useLabels();
  const resolved = label ?? labels.play;

  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel ?? resolved}
      onClick={play}
      style={{ ...chromeBtnStyle(), ...style }}
      {...hoverHandlers()}
    >
      {children ?? icons.play ?? <PlayIcon size={14} />}
      {resolved}
    </button>
  );
}
