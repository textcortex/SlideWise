import type { Slide } from "@/lib/types";
import { SLIDE_W, SLIDE_H } from "@/lib/types";
import { ElementView } from "./ElementView";

export function SlideView({
  slide,
  scale = 1,
}: {
  slide: Slide;
  scale?: number;
}) {
  return (
    <div
      style={{
        width: SLIDE_W * scale,
        height: SLIDE_H * scale,
        background: slide.background,
        position: "relative",
        overflow: "hidden",
        borderRadius: 12 * scale,
        boxShadow: "var(--thumb-shadow)",
      }}
    >
      <div
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "absolute",
          inset: 0,
        }}
      >
        {[...slide.elements]
          .sort((a, b) => a.z - b.z)
          .map((el) => (
            <div
              key={el.id}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.w,
                height: el.h,
                transform: `rotate(${el.rotation}deg)`,
                pointerEvents: "none",
              }}
            >
              <ElementView el={el} />
            </div>
          ))}
      </div>
    </div>
  );
}
