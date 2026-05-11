import type { CSSProperties, PropsWithChildren } from "react";
import { LayoutGrid } from "lucide-react";
import { useEditor } from "@/lib/StoreProvider";

/**
 * Default rail header. Renders the grid-view button and a "current / total"
 * slide counter. Hosts can pass `children` to replace the whole content
 * while keeping the height + border, or render their own `<header>` instead.
 *
 * ```tsx
 * // Default counter
 * <Slidewise.SlideRail.Header />
 *
 * // Custom content
 * <Slidewise.SlideRail.Header>
 *   <strong>{deckTitle}</strong>
 * </Slidewise.SlideRail.Header>
 * ```
 */
export interface SlideRailHeaderProps {
  className?: string;
  style?: CSSProperties;
}

export function Header({
  className,
  style,
  children,
}: PropsWithChildren<SlideRailHeaderProps>) {
  const slides = useEditor((s) => s.deck.slides);
  const currentId = useEditor((s) => s.currentSlideId);
  const setView = useEditor((s) => s.setView);
  const idx = slides.findIndex((s) => s.id === currentId);

  return (
    <div
      className={className}
      style={{
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        fontSize: 12,
        color: "var(--ink-muted)",
        borderBottom: "1px solid var(--border)",
        ...style,
      }}
    >
      {children ?? (
        <>
          <button
            title="Slide overview"
            aria-label="Open slide overview"
            onClick={() => setView("grid")}
            style={{
              width: 28,
              height: 28,
              border: "none",
              borderRadius: 6,
              background: "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--hover-strong)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <LayoutGrid size={14} />
          </button>
          <span>
            {idx + 1} / {slides.length}
          </span>
        </>
      )}
    </div>
  );
}
