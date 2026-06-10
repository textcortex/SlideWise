export {
  SlidewiseEditor,
  type SlidewiseEditorProps,
  type SlidewiseEditorHandle,
} from "./SlidewiseEditor";

export {
  SlidewiseFileEditor,
  type SlidewiseFileEditorProps,
  type SlidewiseFileEditorApi,
} from "./SlidewiseFileEditor";

/**
 * Compound API. Use the namespace import idiom for the full editor:
 *
 * ```tsx
 * import * as Slidewise from "@textcortex/slidewise";
 *
 * <Slidewise.Root deck={deck} onChange={...}>
 *   <Slidewise.TopBar />
 *   <Slidewise.Body>
 *     <Slidewise.SlideRail />
 *     <Slidewise.CanvasFrame>
 *       <Slidewise.Canvas />
 *       <Slidewise.BottomToolbar />
 *     </Slidewise.CanvasFrame>
 *   </Slidewise.Body>
 * </Slidewise.Root>
 * ```
 *
 * Each region reads the editor store via context, so you can replace, wrap,
 * or omit any one. `<Slidewise.RightPanel>` is provided so hosts can inject
 * their own panel content (AI suggestions, comments, etc.) inside the same
 * themed surface.
 */
export {
  Root,
  TopBar,
  SlideRail,
  Canvas,
  BottomToolbar,
  RightPanel,
  Body,
  CanvasFrame,
  useHostCallbacks,
  useIcons,
  useReadOnly,
  useDirty,
  useLabels,
  useSurfaces,
  useCanvasConfig,
  resolveSlideBackground,
  DEFAULT_CANVAS_CONFIG,
  useEditor,
  useEditorStore,
  useSlides,
  useActiveSlide,
  useActiveSlideId,
  useSelection,
  useSelectedElements,
  useTheme,
  useZoom,
  usePlaying,
  useHistory,
  type SlidewiseRootProps,
  type SlidewiseRootHandle,
  type HistoryState,
  type SelectionSnapshot,
  type SlidewiseHostCallbacks,
  type SlidewiseIcons,
  type SlidewiseLabels,
  type SlidewiseSurfaces,
  type SlidewiseCanvasConfig,
  type ResolvedLabels,
  type ResolvedCanvasConfig,
  useSlideRailItem,
  type RegionProps,
  type TopBarProps,
  type TopBarSlotId,
  type SlideRailProps,
  type SlideRailRootProps,
  type SlideRailHeaderProps,
  type SlideRailListProps,
  type SlideRailItemProps,
  type SlideRailThumbnailProps,
  type SlideRailNumberProps,
  type SlideRailAddButtonProps,
  type SlideRailItemContextValue,
} from "./compound";

export { parsePptx, isPptxTemplate, serializeDeck } from "./lib/pptx";
export type { ParseDiagnostics, ParseResult } from "./lib/pptx/types";

export { migrate, CURRENT_DECK_VERSION } from "./lib/schema/migrate";
export { resolveJsonDeck } from "./lib/schema/json";

/**
 * Instantiate a fresh slide from one of the deck's master layouts
 * (`Deck.layouts`, populated by `parsePptx`). The unlock for generating decks
 * with more slides than the template hand-authored, using the template's own
 * layout variety.
 */
export {
  addSlideFromLayout,
  type AddSlideFromLayoutOptions,
} from "./lib/layouts";

/**
 * Chart-option helpers. Build the exact ECharts option Slidewise renders a
 * `ChartElement` with — for host-side previews / server-side render-to-image —
 * without re-implementing (and drifting from) the package's translation.
 */
export {
  buildChartOption,
  defaultPaletteColor,
  makeValueFormatter,
} from "./lib/chart/chartOption";

export type {
  Deck,
  Slide,
  SlideElement,
  ElementType,
  EnterAnim,
  BaseElement,
  TextElement,
  TextRun,
  ShapeElement,
  ShapeKind,
  ShapePath,
  ImageElement,
  LineElement,
  TableElement,
  IconElement,
  EmbedElement,
  ChartElement,
  ChartKind,
  ChartGrouping,
  ChartSeries,
  ConnectorElement,
  ConnectorKind,
  ArrowheadKind,
  GroupElement,
  UnknownElement,
  DeckLayout,
  LayoutPlaceholder,
  ElementDraft,
  ShadowSpec,
  GlowSpec,
  DashType,
  FontAsset,
  WebFontAsset,
} from "./lib/types";
export { SLIDE_W, SLIDE_H } from "./lib/types";
