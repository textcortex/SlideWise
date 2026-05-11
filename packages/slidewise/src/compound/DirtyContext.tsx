import { createContext, useContext, type ReactNode } from "react";

const DirtyContext = createContext<boolean>(false);

export function DirtyProvider({
  dirty,
  children,
}: {
  dirty: boolean;
  children: ReactNode;
}) {
  return <DirtyContext.Provider value={dirty}>{children}</DirtyContext.Provider>;
}

/**
 * Reactive dirty flag. `true` when the deck has uncommitted edits since the
 * last save / mount. Use this from host components anywhere under
 * `<Slidewise.Root>` to render "Unsaved changes" UI without polling
 * `api.isDirty()`.
 *
 * ```tsx
 * function MyHeader() {
 *   const dirty = useDirty();
 *   return dirty ? <Badge>Unsaved</Badge> : null;
 * }
 * ```
 */
export function useDirty(): boolean {
  return useContext(DirtyContext);
}
