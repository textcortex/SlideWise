import type { SlideElement } from "@/lib/types";

/**
 * Result of parsing a PPTX archive. Surfaced to the caller so they can
 * decide whether to warn about lossy fields (animations, transitions,
 * unknown elements that fell into UnknownElement).
 */
export interface ParseDiagnostics {
  unknownElementCount: number;
  droppedAnimations: number;
  warnings: string[];
}

export interface ParseResult {
  diagnostics: ParseDiagnostics;
  elements: SlideElement[];
}
