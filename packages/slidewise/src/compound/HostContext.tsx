import { createContext, useContext, type ReactNode } from "react";
import type { Deck } from "@/lib/types";

/**
 * Host-supplied callbacks consumed by leaf compound parts (e.g. TopBar's
 * save/export buttons). Distinct from the editor store, which owns deck +
 * UI state. This context exists so child parts can invoke host effects
 * without prop-drilling through every region.
 */
export interface SlidewiseHostCallbacks {
  onSave?: (deck: Deck) => void | Promise<void>;
  onExport?: (deck: Deck) => void;
}

const HostContext = createContext<SlidewiseHostCallbacks>({});

export function HostProvider({
  callbacks,
  children,
}: {
  callbacks: SlidewiseHostCallbacks;
  children: ReactNode;
}) {
  return <HostContext.Provider value={callbacks}>{children}</HostContext.Provider>;
}

export function useHostCallbacks(): SlidewiseHostCallbacks {
  return useContext(HostContext);
}
