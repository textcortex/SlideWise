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
  type SlidewiseRootProps,
  type SlidewiseRootHandle,
  type HistoryState,
  type SlidewiseHostCallbacks,
  type SlidewiseIcons,
  type RegionProps,
} from "./compound";

export { parsePptx, serializeDeck } from "./lib/pptx";
export type { ParseDiagnostics, ParseResult } from "./lib/pptx/types";

export { migrate, CURRENT_DECK_VERSION } from "./lib/schema/migrate";

export type {
  Deck,
  Slide,
  SlideElement,
  ElementType,
  EnterAnim,
  BaseElement,
  TextElement,
  ShapeElement,
  ShapeKind,
  ImageElement,
  LineElement,
  TableElement,
  IconElement,
  EmbedElement,
  UnknownElement,
  ElementDraft,
} from "./lib/types";
export { SLIDE_W, SLIDE_H } from "./lib/types";
