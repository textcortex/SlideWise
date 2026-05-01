export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

export type ElementType =
  | "text"
  | "shape"
  | "image"
  | "line"
  | "table"
  | "icon"
  | "embed";

export type EnterAnim =
  | "none"
  | "fade"
  | "slide-up"
  | "slide-down"
  | "slide-left"
  | "slide-right"
  | "scale"
  | "draw";

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: number;
  locked?: boolean;
  enter?: EnterAnim;
  delay?: number;
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  align: "left" | "center" | "right";
  vAlign: "top" | "middle" | "bottom";
  lineHeight: number;
  letterSpacing: number;
}

export type ShapeKind =
  | "rect"
  | "rounded"
  | "circle"
  | "triangle"
  | "star"
  | "diamond";

export interface ShapeElement extends BaseElement {
  type: "shape";
  shape: ShapeKind;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
}

export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
  alt?: string;
  fit: "cover" | "contain";
  radius?: number;
}

export interface LineElement extends BaseElement {
  type: "line";
  stroke: string;
  strokeWidth: number;
  arrow?: boolean;
  dashed?: boolean;
}

export interface TableElement extends BaseElement {
  type: "table";
  rows: string[][];
  headerFill: string;
  rowFill: string;
  textColor: string;
  fontSize: number;
}

export interface IconElement extends BaseElement {
  type: "icon";
  icon: string;
  color: string;
}

export interface EmbedElement extends BaseElement {
  type: "embed";
  url: string;
  label: string;
}

export type SlideElement =
  | TextElement
  | ShapeElement
  | ImageElement
  | LineElement
  | TableElement
  | IconElement
  | EmbedElement;

export interface Slide {
  id: string;
  background: string;
  elements: SlideElement[];
}

export interface Deck {
  title: string;
  slides: Slide[];
}

export type ElementDraft<T extends SlideElement = SlideElement> = T extends SlideElement
  ? Omit<T, "id" | "z">
  : never;
