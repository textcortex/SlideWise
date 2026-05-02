/**
 * Unit conversions between Caracas pixels and PPTX EMU/inches/points.
 *
 * Caracas authors at a fixed 1920×1080 px canvas. PPTX widescreen layout is
 * 13.333 × 7.5 inches (12,192,000 × 6,858,000 EMU). The mapping is linear:
 *   1920 px ↔ 12,192,000 EMU ↔ 13.333 in
 *   1080 px ↔  6,858,000 EMU ↔  7.5 in
 *
 * That gives 6350 EMU per pixel (and 144 px per inch, 0.5 pt per px).
 */

import { SLIDE_W, SLIDE_H } from "@/lib/types";

export const EMU_PER_INCH = 914400;
export const EMU_PER_POINT = 12700;
export const PX_PER_INCH = 144;
export const EMU_PER_PX = EMU_PER_INCH / PX_PER_INCH; // 6350
export const POINTS_PER_PX = 0.5;

export const PPTX_SLIDE_W_INCHES = SLIDE_W / PX_PER_INCH; // 13.333…
export const PPTX_SLIDE_H_INCHES = SLIDE_H / PX_PER_INCH; // 7.5
export const PPTX_SLIDE_W_EMU = SLIDE_W * EMU_PER_PX; // 12,192,000
export const PPTX_SLIDE_H_EMU = SLIDE_H * EMU_PER_PX; //  6,858,000

export const pxToEmu = (px: number): number => Math.round(px * EMU_PER_PX);
export const emuToPx = (emu: number): number => emu / EMU_PER_PX;

export const pxToInches = (px: number): number => px / PX_PER_INCH;
export const inchesToPx = (inches: number): number => inches * PX_PER_INCH;

export const pxToPoints = (px: number): number => px * POINTS_PER_PX;
export const pointsToPx = (pt: number): number => pt / POINTS_PER_PX;
