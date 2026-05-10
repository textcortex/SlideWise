import { createContext, useContext, type ReactNode } from "react";

/**
 * Per-action icon overrides for the editor's chrome. Pass a `ReactNode` for
 * any button you want to skin with your own icon set (Nucleo, custom SVG,
 * etc.). Slots you don't override fall back to the bundled lucide-react
 * icons so partial overrides are fine.
 *
 * The icons are rendered inline at ~14–16px next to text labels; pick an
 * SVG that has a transparent fill and uses `currentColor` for the stroke
 * so it inherits the surrounding `--ink` / `--primary-fg` color.
 */
export interface SlidewiseIcons {
  undo?: ReactNode;
  redo?: ReactNode;
  save?: ReactNode;
  play?: ReactNode;
  stop?: ReactNode;
  /** Sun icon shown in the theme toggle when the dark theme is active. */
  themeLight?: ReactNode;
  /** Moon icon shown in the theme toggle when the light theme is active. */
  themeDark?: ReactNode;
  export?: ReactNode;
  /** "Smart" pill in the title bar. */
  smart?: ReactNode;
}

const IconContext = createContext<SlidewiseIcons>({});

export function IconProvider({
  icons,
  children,
}: {
  icons: SlidewiseIcons;
  children: ReactNode;
}) {
  return <IconContext.Provider value={icons}>{children}</IconContext.Provider>;
}

export function useIcons(): SlidewiseIcons {
  return useContext(IconContext);
}
