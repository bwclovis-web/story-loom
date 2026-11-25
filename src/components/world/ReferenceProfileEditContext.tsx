"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type ReferenceProfileEditApi = {
  /** Bumps when the identity strip asks the profile panel to enter edit mode. */
  requestKey: number;
  requestEdit: () => void;
};

const ReferenceProfileEditContext = createContext<ReferenceProfileEditApi | null>(null);

/** Lets the reference identity strip start Character / Living World profile edit. */
export function ReferenceProfileEditProvider({ children }: { children: ReactNode }) {
  const [requestKey, setRequestKey] = useState(0);
  const value = useMemo<ReferenceProfileEditApi>(
    () => ({
      requestKey,
      requestEdit: () => setRequestKey((key) => key + 1),
    }),
    [requestKey],
  );
  return <ReferenceProfileEditContext.Provider value={value}>{children}</ReferenceProfileEditContext.Provider>;
}

export function useReferenceProfileEditRequest(): ReferenceProfileEditApi | null {
  return useContext(ReferenceProfileEditContext);
}
