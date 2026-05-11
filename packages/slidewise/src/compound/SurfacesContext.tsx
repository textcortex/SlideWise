import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Per-surface background overrides. Each key maps to a CSS variable that the
 * library's stylesheet reads. Values can be any valid CSS background
 * (color, gradient, var() reference, etc.). Equivalent to setting the
 * `--slidewise-bg-*` variables manually — provided as a typed prop so
 * hosts can drive theming from JS.
 *
 * Missing keys fall back to the library's defaults; supply only what you
 * want to override.
 */
export interface SlidewiseSurfaces {
  /** Outermost app shell. Maps to `--slidewise-bg-app`. */
  app?: string;
  /** Top bar surface. `--slidewise-bg-topbar`. */
  topbar?: string;
  /** Slide rail container. `--slidewise-bg-rail`. */
  rail?: string;
  /** Inactive slide rail item. `--slidewise-bg-rail-item`. */
  railItem?: string;
  /** Active/selected slide rail item. `--slidewise-bg-rail-item-active`. */
  railItemActive?: string;
  /** Canvas frame (around the slide). `--slidewise-bg-canvas-frame`. */
  canvasFrame?: string;
  /** Canvas backdrop gradient start. `--slidewise-bg-canvas-from`. */
  canvasFrom?: string;
  /** Canvas backdrop gradient end. `--slidewise-bg-canvas-to`. */
  canvasTo?: string;
  /** Floating bottom toolbar. `--slidewise-bg-bottom-toolbar`. */
  bottomToolbar?: string;
  /** Right panel surface. `--slidewise-bg-right-panel`. */
  rightPanel?: string;
  /** Popover/menu surface. `--slidewise-bg-menu`. */
  menu?: string;
  /** Tooltip surface. `--slidewise-bg-tooltip`. */
  tooltip?: string;
  /** Popover surface. `--slidewise-bg-popover`. */
  popover?: string;
  /** Dialog surface. `--slidewise-bg-dialog`. */
  dialog?: string;
  /** Slide paper. `--slidewise-bg-slide`. */
  slide?: string;
  /** Selection overlay tint. `--slidewise-bg-selection`. */
  selection?: string;
  /** Hover state. `--slidewise-bg-hover`. */
  hover?: string;
  /** Active/pressed state. `--slidewise-bg-active`. */
  active?: string;
  /** Form input. `--slidewise-bg-input`. */
  input?: string;
  /** Chrome button. `--slidewise-bg-button`. */
  button?: string;
  /** Chrome button on hover. `--slidewise-bg-button-hover`. */
  buttonHover?: string;
  /** Smart pill. `--slidewise-bg-pill`. */
  pill?: string;
  /** Unsaved-changes badge. `--slidewise-bg-unsaved-badge`. */
  unsavedBadge?: string;
}

const KEY_TO_VAR: Record<keyof SlidewiseSurfaces, string> = {
  app: "--slidewise-bg-app",
  topbar: "--slidewise-bg-topbar",
  rail: "--slidewise-bg-rail",
  railItem: "--slidewise-bg-rail-item",
  railItemActive: "--slidewise-bg-rail-item-active",
  canvasFrame: "--slidewise-bg-canvas-frame",
  canvasFrom: "--slidewise-bg-canvas-from",
  canvasTo: "--slidewise-bg-canvas-to",
  bottomToolbar: "--slidewise-bg-bottom-toolbar",
  rightPanel: "--slidewise-bg-right-panel",
  menu: "--slidewise-bg-menu",
  tooltip: "--slidewise-bg-tooltip",
  popover: "--slidewise-bg-popover",
  dialog: "--slidewise-bg-dialog",
  slide: "--slidewise-bg-slide",
  selection: "--slidewise-bg-selection",
  hover: "--slidewise-bg-hover",
  active: "--slidewise-bg-active",
  input: "--slidewise-bg-input",
  button: "--slidewise-bg-button",
  buttonHover: "--slidewise-bg-button-hover",
  pill: "--slidewise-bg-pill",
  unsavedBadge: "--slidewise-bg-unsaved-badge",
};

/**
 * Convert a `SlidewiseSurfaces` map into an object suitable for spreading
 * into a React `style` prop. Returns `null` when no overrides are present
 * so the consumer doesn't allocate a fresh style object every render.
 */
export function surfacesToCssVars(
  surfaces: SlidewiseSurfaces | undefined
): Record<string, string> | null {
  if (!surfaces) return null;
  const entries: [string, string][] = [];
  for (const key of Object.keys(KEY_TO_VAR) as (keyof SlidewiseSurfaces)[]) {
    const value = surfaces[key];
    if (value !== undefined) entries.push([KEY_TO_VAR[key], value]);
  }
  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

const SurfacesContext = createContext<SlidewiseSurfaces | null>(null);

export function SurfacesProvider({
  surfaces,
  children,
}: {
  surfaces: SlidewiseSurfaces | undefined;
  children: ReactNode;
}) {
  const value = useMemo(() => surfaces ?? null, [surfaces]);
  return (
    <SurfacesContext.Provider value={value}>{children}</SurfacesContext.Provider>
  );
}

/**
 * Read the surface override map. Mostly used by `<Slidewise.Root>` itself,
 * but exposed so host-rendered surfaces (e.g. a custom panel) can apply
 * the same tokens for visual consistency.
 */
export function useSurfaces(): SlidewiseSurfaces | null {
  return useContext(SurfacesContext);
}
