import type { CSSProperties, ReactNode } from "react";
import { Sun, Moon } from "lucide-react";
import { useEditor } from "@/lib/StoreProvider";
import { useIcons } from "../IconContext";
import { iconBtnStyle, hoverHandlers } from "./styles";

/**
 * Light/dark theme toggle. Always rendered; theme is a viewer concern,
 * not an editing one.
 */
export interface TopBarThemeToggleProps {
  className?: string;
  style?: CSSProperties;
  labels?: { toggleToDark?: string; toggleToLight?: string };
  children?: ReactNode;
}

export function ThemeToggle({
  className,
  style,
  labels,
  children,
}: TopBarThemeToggleProps = {}) {
  const theme = useEditor((s) => s.theme);
  const toggleTheme = useEditor((s) => s.toggleTheme);
  const icons = useIcons();

  const label =
    theme === "dark"
      ? (labels?.toggleToLight ?? "Light mode")
      : (labels?.toggleToDark ?? "Dark mode");

  return (
    <button
      type="button"
      className={className}
      title={label}
      aria-label={label}
      onClick={toggleTheme}
      style={{ ...iconBtnStyle(), ...style }}
      {...hoverHandlers()}
    >
      {children ??
        (theme === "dark"
          ? (icons.themeLight ?? <Sun size={16} />)
          : (icons.themeDark ?? <Moon size={16} />))}
    </button>
  );
}
