import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEditor } from "@/lib/store";
import { SLIDE_W, SLIDE_H, type SlideElement, type EnterAnim } from "@/lib/types";
import { ElementView } from "./ElementView";

export function PlayMode() {
  const slides = useEditor((s) => s.deck.slides);
  const stop = useEditor((s) => s.stop);
  const [index, setIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const compute = () => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      const fit = Math.min(r.width / SLIDE_W, r.height / SLIDE_H);
      setScale(fit);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") stop();
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown")
        setIndex((i) => Math.min(slides.length - 1, i + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp")
        setIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length, stop]);

  const slide = slides[index];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      ref={wrapRef}
    >
      <button
        onClick={stop}
        title="Exit (Esc)"
        aria-label="Exit play mode"
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 40,
          height: 40,
          borderRadius: 999,
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.18)",
          color: "#fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(12px)",
          zIndex: 5,
        }}
      >
        <X size={18} />
      </button>

      <button
        onClick={() => setIndex((i) => Math.max(0, i - 1))}
        disabled={index === 0}
        aria-label="Previous slide"
        title="Previous slide"
        style={{
          position: "absolute",
          left: 16,
          top: "50%",
          transform: "translateY(-50%)",
          width: 44,
          height: 44,
          borderRadius: 999,
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.18)",
          color: "#fff",
          cursor: index === 0 ? "default" : "pointer",
          opacity: index === 0 ? 0.3 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(12px)",
          zIndex: 5,
        }}
      >
        <ChevronLeft size={20} />
      </button>

      <button
        onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))}
        disabled={index === slides.length - 1}
        aria-label="Next slide"
        title="Next slide"
        style={{
          position: "absolute",
          right: 16,
          top: "50%",
          transform: "translateY(-50%)",
          width: 44,
          height: 44,
          borderRadius: 999,
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.18)",
          color: "#fff",
          cursor: index === slides.length - 1 ? "default" : "pointer",
          opacity: index === slides.length - 1 ? 0.3 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(12px)",
          zIndex: 5,
        }}
      >
        <ChevronRight size={20} />
      </button>

      <div
        role="status"
        aria-live="polite"
        aria-label={`Slide ${index + 1} of ${slides.length}`}
        style={{
          position: "absolute",
          bottom: 18,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "6px 12px",
          borderRadius: 999,
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.14)",
          color: "#fff",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 12,
          backdropFilter: "blur(12px)",
        }}
      >
        {index + 1} / {slides.length}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={slide.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          style={{
            width: SLIDE_W * scale,
            height: SLIDE_H * scale,
            background: slide.background,
            position: "relative",
            overflow: "hidden",
            borderRadius: 4,
            boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
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
                <AnimatedElement key={el.id} el={el} />
              ))}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function variantsFor(anim: EnterAnim) {
  switch (anim) {
    case "fade":
      return { initial: { opacity: 0 }, animate: { opacity: 1 } };
    case "slide-up":
      return {
        initial: { opacity: 0, y: 40 },
        animate: { opacity: 1, y: 0 },
      };
    case "slide-down":
      return {
        initial: { opacity: 0, y: -40 },
        animate: { opacity: 1, y: 0 },
      };
    case "slide-left":
      return {
        initial: { opacity: 0, x: 40 },
        animate: { opacity: 1, x: 0 },
      };
    case "slide-right":
      return {
        initial: { opacity: 0, x: -40 },
        animate: { opacity: 1, x: 0 },
      };
    case "scale":
      return {
        initial: { opacity: 0, scale: 0.92 },
        animate: { opacity: 1, scale: 1 },
      };
    case "draw":
      return {
        initial: { opacity: 0, scaleX: 0 },
        animate: { opacity: 1, scaleX: 1 },
      };
    case "none":
    default:
      return { initial: { opacity: 1 }, animate: { opacity: 1 } };
  }
}

function AnimatedElement({ el }: { el: SlideElement }) {
  const v = variantsFor(el.enter ?? "fade");
  return (
    <motion.div
      initial={v.initial}
      animate={v.animate}
      transition={{
        duration: 0.55,
        delay: el.delay ?? 0,
        ease: [0.22, 1, 0.36, 1],
      }}
      style={{
        position: "absolute",
        left: el.x,
        top: el.y,
        width: el.w,
        height: el.h,
        transform: `rotate(${el.rotation}deg)`,
        transformOrigin: el.enter === "draw" ? "left center" : "center",
      }}
    >
      <ElementView el={el} />
    </motion.div>
  );
}
