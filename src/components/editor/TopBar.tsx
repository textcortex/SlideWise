import {
  Undo2,
  Redo2,
  Save,
  Play,
  Download,
  Sparkles,
  Sun,
  Moon,
} from "lucide-react";
import { useEditor } from "@/lib/store";
import { useState } from "react";

export function TopBar() {
  const title = useEditor((s) => s.deck.title);
  const setTitle = useEditor((s) => s.setTitle);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const play = useEditor((s) => s.play);
  const theme = useEditor((s) => s.theme);
  const toggleTheme = useEditor((s) => s.toggleTheme);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");

  const onSave = () => {
    setSaved("saving");
    try {
      const deck = useEditor.getState().deck;
      localStorage.setItem("caracas-deck", JSON.stringify(deck));
      setTimeout(() => setSaved("saved"), 320);
      setTimeout(() => setSaved("idle"), 1600);
    } catch {
      setSaved("idle");
    }
  };

  const onExport = () => {
    const deck = useEditor.getState().deck;
    const blob = new Blob([JSON.stringify(deck, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(deck.title || "deck").replace(/[^a-z0-9-_]+/gi, "-")}.caracas.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{
        height: 56,
        display: "flex",
        alignItems: "center",
        padding: "0 14px",
        gap: 10,
        background: "var(--app-bg)",
        borderBottom: "1px solid var(--border)",
        boxShadow: "var(--topbar-shadow)",
        fontFamily: "Inter, system-ui, sans-serif",
        position: "relative",
        zIndex: 10,
        color: "var(--ink)",
      }}
    >
      <IconBtn onClick={undo} title="Undo">
        <Undo2 size={16} />
      </IconBtn>
      <IconBtn onClick={redo} title="Redo">
        <Redo2 size={16} />
      </IconBtn>

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 8px",
            background: "var(--smart-grad)",
            color: "var(--smart-fg)",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.2,
          }}
        >
          <Sparkles size={11} />
          Smart
        </span>
        <input
          aria-label="Deck title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{
            background: "transparent",
            border: "none",
            fontSize: 14,
            fontWeight: 500,
            color: "var(--ink)",
            textAlign: "center",
            minWidth: 240,
            maxWidth: 520,
          }}
        />
      </div>

      <IconBtn
        onClick={toggleTheme}
        title={theme === "dark" ? "Light mode" : "Dark mode"}
      >
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </IconBtn>

      <button
        onClick={onSave}
        style={chromeBtnStyle()}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <Save size={14} />
        {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : "Save"}
      </button>

      <button
        onClick={play}
        style={chromeBtnStyle()}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <Play size={14} />
        Play
      </button>

      <button
        onClick={onExport}
        style={{
          height: 32,
          padding: "0 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "var(--primary-bg)",
          border: "1px solid var(--primary-bg)",
          borderRadius: 10,
          cursor: "pointer",
          color: "var(--primary-fg)",
          fontSize: 13,
          fontWeight: 500,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--primary-bg-hover)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = "var(--primary-bg)")
        }
      >
        <Download size={14} />
        Export
      </button>
    </div>
  );
}

function chromeBtnStyle(): React.CSSProperties {
  return {
    height: 32,
    padding: "0 12px",
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1px solid var(--border-strong)",
    borderRadius: 10,
    cursor: "pointer",
    color: "var(--ink)",
    fontSize: 13,
    fontWeight: 500,
  };
}

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ink)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}
