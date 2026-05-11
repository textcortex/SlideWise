import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Slide } from "@/lib/types";

/**
 * Canvas/viewport configuration. Lets hosts tame the slide presentation so a
 * slide with a bold background fill doesn't paint the entire workspace —
 * which is what `<Slidewise.Root>` did by default before this prop existed.
 *
 * Pass any subset:
 *
 * ```tsx
 * <Slidewise.Root
 *   canvas={{
 *     padding: { x: 48, y: 32 },
 *     defaultZoom: 0.7,
 *     slideRadius: 12,
 *     slideShadow:
 *       "0 1px 2px rgba(0,0,0,0.25), 0 24px 60px rgba(0,0,0,0.45)",
 *     resolveSlideBackground: (slide) =>
 *       hostThemeOverridesSlideBg ? "#ffffff" : undefined,
 *   }}
 * >
 * ```
 *
 * Outside the slide rectangle hosts still own the canvas-frame backdrop via
 * the `--slidewise-bg-canvas-from` / `--slidewise-bg-canvas-to` CSS tokens
 * or the `surfaces.canvasFrom` / `surfaces.canvasTo` prop entries.
 */
export interface SlidewiseCanvasConfig {
  /**
   * Padding between the slide and the canvas frame, in pixels. Used both
   * for the auto-fit calculation and as actual whitespace around the
   * slide. Pass a number for uniform padding, or an object for per-axis
   * control. Default: roughly the room the floating toolbars need —
   * 32px horizontal, ~148px vertical (top bar + bottom toolbar).
   */
  padding?: number | { x?: number; y?: number };
  /**
   * How the slide scales inside the canvas:
   * - `"fit"` (default) auto-shrinks the slide to fit while preserving aspect
   * - `"fill"` reserved for a future fill behavior; currently equivalent to fit
   * - `"manual"` uses `defaultZoom` (or whatever the user has set via
   *   `api.setZoom` / pinch-zoom) verbatim
   *
   * Applied via `store.setFitMode()` once on mount. Subsequent user
   * interactions (zoom in, fit toggle) override this.
   */
  fitMode?: "fit" | "fill" | "manual";
  /**
   * Initial zoom level when `fitMode === "manual"` (or as a starting point
   * when the user switches off auto-fit). 1 = 100%. Clamped to [0.1, 4].
   */
  defaultZoom?: number;
  /**
   * Box-shadow applied to the slide paper. Any valid CSS `box-shadow`
   * value. Defaults to `var(--slide-shadow)`.
   */
  slideShadow?: string;
  /**
   * Border-radius applied to the slide paper. Number = pixels; string =
   * any valid CSS length. Defaults to `8`.
   */
  slideRadius?: number | string;
  /**
   * Hard-override the slide's background paint regardless of what the
   * deck's `slide.background` says. Useful when the host wants every
   * slide to render as a neutral surface (`#ffffff`, host-tinted, etc.)
   * for a viewer experience where the deck's baked fills would clash
   * with the chrome.
   *
   * If both `forceSlideBackground` and `resolveSlideBackground` are
   * passed, the force value wins.
   */
  forceSlideBackground?: string;
  /**
   * Per-slide background resolver. Receives the current slide; return a
   * CSS value to override, or `undefined` to fall through to the slide's
   * own `background` property. Useful for "respect host theme but only
   * for slides that don't explicitly set a fill" patterns.
   */
  resolveSlideBackground?: (slide: Slide) => string | undefined;
}

/**
 * Fully-resolved canvas config, with internal defaults filled in. Consumers
 * (the Canvas component, host-rendered surfaces) read this shape via
 * `useCanvasConfig()` and never have to check for undefined.
 */
export interface ResolvedCanvasConfig {
  padding: { x: number; y: number };
  fitMode: "fit" | "fill" | "manual" | null;
  defaultZoom: number | null;
  slideShadow: string;
  slideRadius: number | string;
  forceSlideBackground: string | null;
  resolveSlideBackground:
    | ((slide: Slide) => string | undefined)
    | null;
}

export const DEFAULT_CANVAS_CONFIG: ResolvedCanvasConfig = {
  // Matches the previous hardcoded padX=32 / padY=56+76+16 in Canvas.tsx —
  // enough vertical room for the top bar + the floating bottom toolbar.
  padding: { x: 32, y: 148 },
  fitMode: null,
  defaultZoom: null,
  slideShadow: "var(--slide-shadow)",
  slideRadius: 8,
  forceSlideBackground: null,
  resolveSlideBackground: null,
};

function mergeCanvasConfig(
  config: SlidewiseCanvasConfig | undefined
): ResolvedCanvasConfig {
  if (!config) return DEFAULT_CANVAS_CONFIG;
  let padding = DEFAULT_CANVAS_CONFIG.padding;
  if (typeof config.padding === "number") {
    padding = { x: config.padding, y: config.padding };
  } else if (config.padding && typeof config.padding === "object") {
    padding = {
      x: config.padding.x ?? DEFAULT_CANVAS_CONFIG.padding.x,
      y: config.padding.y ?? DEFAULT_CANVAS_CONFIG.padding.y,
    };
  }
  return {
    padding,
    fitMode: config.fitMode ?? null,
    defaultZoom: config.defaultZoom ?? null,
    slideShadow: config.slideShadow ?? DEFAULT_CANVAS_CONFIG.slideShadow,
    slideRadius: config.slideRadius ?? DEFAULT_CANVAS_CONFIG.slideRadius,
    forceSlideBackground: config.forceSlideBackground ?? null,
    resolveSlideBackground: config.resolveSlideBackground ?? null,
  };
}

const CanvasContext = createContext<ResolvedCanvasConfig>(DEFAULT_CANVAS_CONFIG);

export function CanvasConfigProvider({
  config,
  children,
}: {
  config: SlidewiseCanvasConfig | undefined;
  children: ReactNode;
}) {
  const value = useMemo(() => mergeCanvasConfig(config), [config]);
  return (
    <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>
  );
}

/**
 * Read the resolved canvas configuration. Always returns a complete object
 * with defaults filled in.
 */
export function useCanvasConfig(): ResolvedCanvasConfig {
  return useContext(CanvasContext);
}

/**
 * Convenience helper used by the internal Canvas component (and exported
 * so host-rendered slide previews can reuse the same resolution rules).
 * Returns whatever the canvas config says, falling back to the slide's
 * own `background` property.
 */
export function resolveSlideBackground(
  config: ResolvedCanvasConfig,
  slide: Slide
): string {
  if (config.forceSlideBackground) return config.forceSlideBackground;
  if (config.resolveSlideBackground) {
    const resolved = config.resolveSlideBackground(slide);
    if (resolved !== undefined) return resolved;
  }
  return slide.background;
}
