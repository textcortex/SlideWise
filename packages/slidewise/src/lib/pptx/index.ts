export { parsePptx, isPptxTemplate } from "./pptxToDeck";
export { serializeDeck } from "./deckToPptx";
export type {
  SerializeOptions,
  SerializeWarning,
  SvgRasterizer,
} from "./deckToPptx";
export type { ParseDiagnostics, ParseResult } from "./types";
export { applyEdits } from "./applyEdits";
export type {
  EditPlan,
  PlannedSlide,
  Edit,
  Run,
  Series,
  Rect,
  ApplyEditsOptions,
} from "./applyEdits";
