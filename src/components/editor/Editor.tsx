import { useEffect } from "react";
import { useEditor } from "@/lib/store";
import { TopBar } from "./TopBar";
import { SlideRail } from "./SlideRail";
import { Canvas } from "./Canvas";
import { BottomToolbar } from "./BottomToolbar";
import { PlayMode } from "./PlayMode";
import { GridView } from "./GridView";

export function Editor() {
  const playing = useEditor((s) => s.playing);
  const view = useEditor((s) => s.view);
  const theme = useEditor((s) => s.theme);
  const setTheme = useEditor((s) => s.setTheme);

  useEffect(() => {
    let initial: "light" | "dark" = "light";
    try {
      const saved = localStorage.getItem("caracas-theme");
      if (saved === "dark" || saved === "light") initial = saved;
      else if (
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      ) {
        initial = "dark";
      }
    } catch {}
    setTheme(initial);
  }, [setTheme]);

  return (
    <div
      className={`theme-${theme}`}
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--app-bg)",
        color: "var(--ink)",
        overflow: "hidden",
      }}
    >
      <TopBar />
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <SlideRail />
        <div style={{ flex: 1, display: "flex", position: "relative" }}>
          <Canvas />
          <BottomToolbar />
        </div>
      </div>
      {view === "grid" && <GridView />}
      {playing && <PlayMode />}
    </div>
  );
}
