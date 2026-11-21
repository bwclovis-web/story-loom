"use client";

import { useEffect, useState } from "react";
import {
  parseRecoveryDraft,
  recoveryDiffers,
  recoveryKey,
  type RecoveryBaseline,
  type RecoveryDraft,
} from "@/writing/localRecovery";

export function useLocalRecovery(input: {
  recordId: string;
  revision: number;
  baseline: RecoveryBaseline;
  current: RecoveryBaseline;
  enabled: boolean;
  saved: boolean;
  onRestore: (draft: RecoveryDraft) => void;
}) {
  const [pending, setPending] = useState<RecoveryDraft | null>(null);
  const key = recoveryKey(input.recordId, input.revision);
  const baselineKey = `${input.baseline.title}\n${input.baseline.body}\n${input.baseline.fields}`;
  const currentKey = `${input.current.title}\n${input.current.body}\n${input.current.fields}`;

  useEffect(() => {
    if (!input.enabled || typeof localStorage === "undefined") return;
    const parsed = parseRecoveryDraft(localStorage.getItem(key));
    if (parsed && recoveryDiffers(input.baseline, parsed)) setPending(parsed);
    else setPending(null);
  }, [key, input.enabled, baselineKey, input.baseline]);

  useEffect(() => {
    if (!input.enabled || typeof localStorage === "undefined") return;
    if (input.saved) {
      localStorage.removeItem(key);
      localStorage.removeItem(recoveryKey(input.recordId, input.revision - 1));
      setPending(null);
      return;
    }
    if (pending) return;
    const stored = parseRecoveryDraft(localStorage.getItem(key));
    const crashWaiting = stored !== null && recoveryDiffers(input.baseline, stored) && !recoveryDiffers(input.baseline, input.current);
    if (crashWaiting) return;
    if (!recoveryDiffers(input.baseline, input.current)) {
      localStorage.removeItem(key);
      return;
    }
    const handle = window.setTimeout(() => {
      const draft: RecoveryDraft = { ...input.current, savedAt: new Date().toISOString() };
      try {
        localStorage.setItem(key, JSON.stringify(draft));
      } catch {
        // A full disk must not block editing.
      }
    }, 800);
    return () => window.clearTimeout(handle);
  }, [key, input.enabled, input.saved, input.recordId, input.revision, currentKey, baselineKey, input.current, input.baseline, pending]);

  function discard() {
    localStorage.removeItem(key);
    setPending(null);
  }

  function restore() {
    if (!pending) return;
    input.onRestore(pending);
    setPending(null);
  }

  return { pending, discard, restore };
}
