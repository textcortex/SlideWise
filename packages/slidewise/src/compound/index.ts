/**
 * Compound API for Slidewise. Use these primitives when you want to compose
 * the editor — replacing, wrapping, or omitting any region. Hosts that just
 * want the default editor can keep using `<SlidewiseEditor>`, which is a
 * thin wrapper rendering this same tree:
 *
 * ```tsx
 * <Slidewise.Root deck={deck} onChange={…} onSave={…}>
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
 * Use the namespace import to keep call sites tidy:
 *
 * ```tsx
 * import * as Slidewise from "@textcortex/slidewise";
 * ```
 */
export {
  Root,
  type SlidewiseRootProps,
  type SlidewiseRootHandle,
} from "./SlidewiseRoot";
export {
  TopBar,
  SlideRail,
  Canvas,
  BottomToolbar,
  RightPanel,
  Body,
  CanvasFrame,
  type RegionProps,
} from "./parts";
export {
  useHostCallbacks,
  type SlidewiseHostCallbacks,
} from "./HostContext";
export {
  IconProvider,
  useIcons,
  type SlidewiseIcons,
} from "./IconContext";
export { ReadOnlyProvider, useReadOnly } from "./ReadOnlyContext";
