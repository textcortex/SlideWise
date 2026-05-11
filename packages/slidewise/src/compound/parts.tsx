import type { CSSProperties, ReactNode } from "react";
import { SlideRail as SlideRailInternal } from "@/components/editor/SlideRail";
import { Canvas as CanvasInternal } from "@/components/editor/Canvas";
import { BottomToolbar as BottomToolbarInternal } from "@/components/editor/BottomToolbar";

/**
 * Region-level compound parts. Each consumes the editor store via context,
 * so any part can be omitted, wrapped, or replaced. None of these accept
 * deck/onChange/onSave props — those live on `<Slidewise.Root>`.
 *
 * Note: `<Slidewise.TopBar>` is defined separately in `./topbar/` because
 * it itself decomposes into subparts (`TopBar.Root`, `TopBar.Title`,
 * `TopBar.Undo`, etc.) and ships a `hide` prop for per-button removal.
 */

export interface RegionProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Left-side slide thumbnail rail with add/duplicate/delete.
 */
export function SlideRail(_props: RegionProps = {}) {
  return <SlideRailInternal />;
}

/**
 * The main editing canvas. This is the only part that's effectively required
 * — without it the editor renders nothing visible. Layout-wise it expects
 * a flex container that gives it `flex: 1`; the default layout takes care of
 * this when you also render `<Slidewise.Body>`.
 */
export function Canvas(_props: RegionProps = {}) {
  return <CanvasInternal />;
}

/**
 * Floating bottom toolbar with the active-tool selector (select / text /
 * shape / etc.). Optional — omit it if your host has its own tool surface.
 */
export function BottomToolbar(_props: RegionProps = {}) {
  return <BottomToolbarInternal />;
}

/**
 * Right-side properties panel. The default editor doesn't ship a built-in
 * inspector yet — this slot is rendered for hosts that want to inject their
 * own (AI suggestions, comments, element properties, etc.). Pass `children`
 * to fill the slot; the part handles the layout (fixed width column, themed
 * surface) so injected content blends with the rest of the editor.
 */
export function RightPanel({
  className,
  style,
  children,
  width = 320,
}: RegionProps & { children?: ReactNode; width?: number | string }) {
  if (!children) return null;
  return (
    <aside
      className={
        className
          ? `slidewise-right-panel ${className}`
          : "slidewise-right-panel"
      }
      style={{
        width,
        flexShrink: 0,
        height: "100%",
        background: "var(--rail-bg)",
        borderLeft: "1px solid var(--border)",
        boxShadow: "var(--rail-shadow)",
        overflow: "auto",
        ...style,
      }}
    >
      {children}
    </aside>
  );
}

/**
 * Default body layout — slide rail + canvas + (optional) right panel side
 * by side. Most hosts compose this manually:
 *
 * ```tsx
 * <Slidewise.Root deck={deck}>
 *   <Slidewise.TopBar />
 *   <Slidewise.Body>
 *     <Slidewise.SlideRail />
 *     <Slidewise.Canvas />
 *     <Slidewise.BottomToolbar />
 *   </Slidewise.Body>
 * </Slidewise.Root>
 * ```
 *
 * Provided as a convenience so most hosts don't have to repeat the flex
 * row + relative positioning that BottomToolbar's anchor expects.
 */
export function Body({ className, style, children }: RegionProps & { children?: ReactNode }) {
  return (
    <div
      className={
        className ? `slidewise-body ${className}` : "slidewise-body"
      }
      style={{
        flex: 1,
        display: "flex",
        overflow: "hidden",
        position: "relative",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Wraps `<Slidewise.Canvas>` with the relative positioning that
 * `<Slidewise.BottomToolbar>` anchors to. Use it when you want the toolbar
 * to float over the canvas — which is what the default editor does:
 *
 * ```tsx
 * <Slidewise.CanvasFrame>
 *   <Slidewise.Canvas />
 *   <Slidewise.BottomToolbar />
 * </Slidewise.CanvasFrame>
 * ```
 */
export function CanvasFrame({
  className,
  style,
  children,
}: RegionProps & { children?: ReactNode }) {
  return (
    <div
      className={
        className
          ? `slidewise-canvas-frame ${className}`
          : "slidewise-canvas-frame"
      }
      style={{ flex: 1, display: "flex", position: "relative", ...style }}
    >
      {children}
    </div>
  );
}
