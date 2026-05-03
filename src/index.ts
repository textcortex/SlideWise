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
