"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type AssistantComposerActions = {
  focusQuestion: () => void;
  openContextForPassage: () => void;
  openContextForProposal: () => void;
};

const ComposerActionsContext = createContext<AssistantComposerActions | null>(null);
const ComposerRegisterContext = createContext<((actions: AssistantComposerActions | null) => void) | null>(null);

export function AssistantComposerProvider({ children }: { children: ReactNode }) {
  const actionsRef = useRef<AssistantComposerActions | null>(null);
  const [ready, setReady] = useState(false);
  const register = useMemo(
    () => (next: AssistantComposerActions | null) => {
      const had = actionsRef.current !== null;
      actionsRef.current = next;
      if (next && !had) setReady(true);
      else if (!next && had) setReady(false);
    },
    [],
  );
  const actions = ready ? actionsRef.current : null;
  return (
    <ComposerRegisterContext.Provider value={register}>
      <ComposerActionsContext.Provider value={actions}>{children}</ComposerActionsContext.Provider>
    </ComposerRegisterContext.Provider>
  );
}

export function useRegisterAssistantComposer(actions: AssistantComposerActions | null) {
  const register = useContext(ComposerRegisterContext);
  useEffect(() => {
    if (!register) return;
    register(actions);
    return () => register(null);
  }, [register, actions]);
}

export function useAssistantComposerActions(): AssistantComposerActions | null {
  return useContext(ComposerActionsContext);
}