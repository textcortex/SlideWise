import { createContext, useContext, type ReactNode } from "react";

const ReadOnlyContext = createContext<boolean>(false);

export function ReadOnlyProvider({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: ReactNode;
}) {
  return (
    <ReadOnlyContext.Provider value={readOnly}>{children}</ReadOnlyContext.Provider>
  );
}

/**
 * Read-only mode flag. Region parts (TopBar, Canvas) hide editing affordances
 * and skip mutation handlers when this is `true`.
 */
export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}
