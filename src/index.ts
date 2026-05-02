export {
  CaracasEditor,
  type CaracasEditorProps,
  type CaracasEditorHandle,
} from "./CaracasEditor";

export {
  CaracasFileEditor,
  type CaracasFileEditorProps,
  type CaracasFileEditorApi,
} from "./CaracasFileEditor";

export { parsePptx, serializeDeck } from "./lib/pptx";
export type { ParseDiagnostics, ParseResult } from "./lib/pptx/types";

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
