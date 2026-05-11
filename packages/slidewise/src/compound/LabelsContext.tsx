import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Every user-visible string in the editor's chrome. Pass any subset on
 * `<Slidewise.Root labels={...}>` to localise; missing entries fall back
 * to the English defaults. Use this prop together with `icons` to fully
 * skin Slidewise for non-English deployments.
 *
 * Single-string entries are used both as the button's visible label AND
 * as its `aria-label`. Where the two need to diverge (the Save button
 * cycles through three states; the theme toggle shows different labels
 * per theme), nested keys are provided.
 */
export interface SlidewiseLabels {
  // TopBar buttons (visible text)
  save?: { idle?: string; saving?: string; saved?: string };
  play?: string;
  stop?: string;
  export?: string;
  undo?: string;
  redo?: string;
  themeToggle?: { toDark?: string; toLight?: string };

  // Pills + status indicators
  smart?: string;
  unsavedBadge?: string;

  // Inputs
  titleAriaLabel?: string;

  // SlideRail (reserved for the future SlideRail compound subparts)
  addSlide?: string;
  duplicateSlide?: string;
  deleteSlide?: string;

  // Errors
  fileLoadError?: (msg: string) => string;
  fileLoading?: string;
}

/**
 * The fully-resolved label table — every key present, no optionals. Internal
 * components read this directly so they never have to check for undefined.
 */
export interface ResolvedLabels {
  save: { idle: string; saving: string; saved: string };
  play: string;
  stop: string;
  export: string;
  undo: string;
  redo: string;
  themeToggle: { toDark: string; toLight: string };
  smart: string;
  unsavedBadge: string;
  titleAriaLabel: string;
  addSlide: string;
  duplicateSlide: string;
  deleteSlide: string;
  fileLoadError: (msg: string) => string;
  fileLoading: string;
}

export const DEFAULT_LABELS: ResolvedLabels = {
  save: { idle: "Save", saving: "Saving…", saved: "Saved" },
  play: "Play",
  stop: "Stop",
  export: "Export",
  undo: "Undo",
  redo: "Redo",
  themeToggle: { toDark: "Dark mode", toLight: "Light mode" },
  smart: "Smart",
  unsavedBadge: "Unsaved changes",
  titleAriaLabel: "Deck title",
  addSlide: "Add slide",
  duplicateSlide: "Duplicate slide",
  deleteSlide: "Delete slide",
  fileLoadError: (msg) => `Could not open file: ${msg}`,
  fileLoading: "Loading…",
};

function mergeLabels(
  overrides: SlidewiseLabels | undefined
): ResolvedLabels {
  if (!overrides) return DEFAULT_LABELS;
  return {
    save: { ...DEFAULT_LABELS.save, ...overrides.save },
    play: overrides.play ?? DEFAULT_LABELS.play,
    stop: overrides.stop ?? DEFAULT_LABELS.stop,
    export: overrides.export ?? DEFAULT_LABELS.export,
    undo: overrides.undo ?? DEFAULT_LABELS.undo,
    redo: overrides.redo ?? DEFAULT_LABELS.redo,
    themeToggle: { ...DEFAULT_LABELS.themeToggle, ...overrides.themeToggle },
    smart: overrides.smart ?? DEFAULT_LABELS.smart,
    unsavedBadge: overrides.unsavedBadge ?? DEFAULT_LABELS.unsavedBadge,
    titleAriaLabel: overrides.titleAriaLabel ?? DEFAULT_LABELS.titleAriaLabel,
    addSlide: overrides.addSlide ?? DEFAULT_LABELS.addSlide,
    duplicateSlide: overrides.duplicateSlide ?? DEFAULT_LABELS.duplicateSlide,
    deleteSlide: overrides.deleteSlide ?? DEFAULT_LABELS.deleteSlide,
    fileLoadError: overrides.fileLoadError ?? DEFAULT_LABELS.fileLoadError,
    fileLoading: overrides.fileLoading ?? DEFAULT_LABELS.fileLoading,
  };
}

const LabelsContext = createContext<ResolvedLabels>(DEFAULT_LABELS);

export function LabelsProvider({
  labels,
  children,
}: {
  labels: SlidewiseLabels | undefined;
  children: ReactNode;
}) {
  const resolved = useMemo(() => mergeLabels(labels), [labels]);
  return (
    <LabelsContext.Provider value={resolved}>{children}</LabelsContext.Provider>
  );
}

export function useLabels(): ResolvedLabels {
  return useContext(LabelsContext);
}
