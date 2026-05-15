import type { CSSProperties } from "react";
import { Root, type TopBarRootProps } from "./Root";
import { Title, type TopBarTitleProps } from "./Title";
import { Undo, type TopBarUndoProps } from "./Undo";
import { Redo, type TopBarRedoProps } from "./Redo";
import { Save, type TopBarSaveProps } from "./Save";
import { Play, type TopBarPlayProps } from "./Play";
import { ThemeToggle, type TopBarThemeToggleProps } from "./ThemeToggle";
import { Export, type TopBarExportProps } from "./Export";
import { Spacer, type TopBarSpacerProps } from "./Spacer";
import { Group, type TopBarGroupProps } from "./Group";

export type TopBarSlotId =
  | "undo"
  | "redo"
  | "title"
  | "themeToggle"
  | "save"
  | "play"
  | "export";

export interface TopBarProps {
  /**
   * Hide individual default buttons without dropping to the compound API.
   * Pass any subset of slot ids; the rest render as usual. Read-only mode
   * already hides save/undo/redo regardless of this prop.
   *
   * ```tsx
   * <Slidewise.TopBar hide={["export", "play"]} />
   * ```
   */
  hide?: TopBarSlotId[];
  /** Hide the leading "Smart" pill on the title. */
  hideSmart?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Default TopBar arrangement. Equivalent to:
 *
 * ```tsx
 * <Slidewise.TopBar.Root>
 *   <Slidewise.TopBar.Group>
 *     <Slidewise.TopBar.Undo />
 *     <Slidewise.TopBar.Redo />
 *   </Slidewise.TopBar.Group>
 *   <Slidewise.TopBar.Title />
 *   <Slidewise.TopBar.ThemeToggle />
 *   <Slidewise.TopBar.Save />
 *   <Slidewise.TopBar.Play />
 *   <Slidewise.TopBar.Export />
 * </Slidewise.TopBar.Root>
 * ```
 *
 * For full control over which subparts render, in what order, and
 * intermixed with host UI, drop down to `<Slidewise.TopBar.Root>` and the
 * named subparts directly.
 */
function DefaultTopBar({ hide, hideSmart, className, style }: TopBarProps = {}) {
  const hidden = new Set(hide ?? []);
  return (
    <Root className={className} style={style}>
      {(!hidden.has("undo") || !hidden.has("redo")) && (
        <Group>
          {!hidden.has("undo") && <Undo />}
          {!hidden.has("redo") && <Redo />}
        </Group>
      )}
      {!hidden.has("title") && <Title hideSmart={hideSmart} />}
      {!hidden.has("themeToggle") && <ThemeToggle />}
      {!hidden.has("save") && <Save />}
      {!hidden.has("play") && <Play />}
      {!hidden.has("export") && <Export />}
    </Root>
  );
}

/**
 * `<Slidewise.TopBar />` is both a callable component (rendering the
 * default arrangement) and a namespace of subparts (`TopBar.Root`,
 * `TopBar.Title`, etc.) for full compound composition. The dual API
 * mirrors dialux's Dialog / Radix's Dialog patterns.
 */
export const TopBar = Object.assign(DefaultTopBar, {
  Root,
  Title,
  Undo,
  Redo,
  Save,
  Play,
  ThemeToggle,
  Export,
  Spacer,
  Group,
});

export type {
  TopBarRootProps,
  TopBarTitleProps,
  TopBarUndoProps,
  TopBarRedoProps,
  TopBarSaveProps,
  TopBarPlayProps,
  TopBarThemeToggleProps,
  TopBarExportProps,
  TopBarSpacerProps,
  TopBarGroupProps,
};
