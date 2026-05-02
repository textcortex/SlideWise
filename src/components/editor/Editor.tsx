import { useEditor } from "@/lib/StoreProvider";
import type { Deck } from "@/lib/types";
import { TopBar } from "./TopBar";
import { SlideRail } from "./SlideRail";
import { Canvas } from "./Canvas";
import { BottomToolbar } from "./BottomToolbar";
import { PlayMode } from "./PlayMode";
import { GridView } from "./GridView";

interface EditorProps {
  showTopBar?: boolean;
  onSave?: (deck: Deck) => void | Promise<void>;
  onExport?: (deck: Deck) => void;
}

export function Editor({ showTopBar = true, onSave, onExport }: EditorProps = {}) {
  const playing = useEditor((s) => s.playing);
  const view = useEditor((s) => s.view);
  const theme = useEditor((s) => s.theme);

  return (
    <div
      className={`caracas-editor theme-${theme}`}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--app-bg)",
        color: "var(--ink)",
        overflow: "hidden",
      }}
    >
      {showTopBar && <TopBar onSave={onSave} onExport={onExport} />}
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
