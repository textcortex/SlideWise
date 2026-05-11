/**
 * Compound API for Slidewise. Use these primitives when you want to compose
 * the editor — replacing, wrapping, or omitting any region. Hosts that just
 * want the default editor can keep using `<SlidewiseEditor>`, which is a
 * thin wrapper rendering this same tree:
 *
 * ```tsx
 * <Slidewise.Root deck={deck} onChange={...} onSave={...}>
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
 * For full control over the top bar (host buttons mixed in, subparts
 * reordered, individual buttons skinned), drop down to its subparts:
 *
 * ```tsx
 * <Slidewise.TopBar.Root>
 *   <MyExitButton />
 *   <Slidewise.TopBar.Spacer />
 *   <Slidewise.TopBar.Group>
 *     <Slidewise.TopBar.Undo />
 *     <Slidewise.TopBar.Redo />
 *   </Slidewise.TopBar.Group>
 *   <Slidewise.TopBar.Save />
 * </Slidewise.TopBar.Root>
 * ```
 */
export {
  Root,
  type SlidewiseRootProps,
  type SlidewiseRootHandle,
  type HistoryState,
  type SelectionSnapshot,
} from "./SlidewiseRoot";
export {
  Canvas,
  BottomToolbar,
  RightPanel,
  Body,
  CanvasFrame,
  type RegionProps,
} from "./parts";

export { TopBar, type TopBarProps, type TopBarSlotId } from "./topbar";
export {
  SlideRail,
  useSlideRailItem,
  type SlideRailProps,
  type SlideRailRootProps,
  type SlideRailHeaderProps,
  type SlideRailListProps,
  type SlideRailItemProps,
  type SlideRailThumbnailProps,
  type SlideRailNumberProps,
  type SlideRailAddButtonProps,
  type SlideRailItemContextValue,
} from "./sliderail";
export type {
  TopBarRootProps,
  TopBarTitleProps,
  TopBarUndoProps,
  TopBarRedoProps,
  TopBarSaveProps,
  TopBarPlayProps,
  TopBarThemeToggleProps,
  TopBarExportProps,
  TopBarSpacerProps,
  TopBarGroupProps,
} from "./topbar";

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
export { DirtyProvider, useDirty } from "./DirtyContext";
export {
  LabelsProvider,
  useLabels,
  DEFAULT_LABELS,
  type SlidewiseLabels,
  type ResolvedLabels,
} from "./LabelsContext";
export {
  SurfacesProvider,
  useSurfaces,
  surfacesToCssVars,
  type SlidewiseSurfaces,
} from "./SurfacesContext";
export {
  CanvasConfigProvider,
  useCanvasConfig,
  resolveSlideBackground,
  DEFAULT_CANVAS_CONFIG,
  type SlidewiseCanvasConfig,
  type ResolvedCanvasConfig,
} from "./CanvasContext";

/**
 * Store hooks. Use these from host components anywhere under
 * `<Slidewise.Root>` to read or write editor state without prop drilling.
 */
export {
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
} from "./hooks";
