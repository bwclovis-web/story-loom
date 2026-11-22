"use client";

import { useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "scheduled" | "saving" | "saved" | "error";

export interface AutosavePayload {
  expectedRevision: number;
  title: string;
  body: string;
  fields: string;
}

/**
 * Debounced unlocked autosave. Protected records must pass enabled=false.
 * Serialises in-flight saves; schedules another pass when still dirty after.
 */
export function useAutosave(input: {
  enabled: boolean;
  dirty: boolean;
  revision: number;
  title: string;
  body: string;
  fields: string;
  idleMs?: number;
  maxIntervalMs?: number;
  save: (payload: AutosavePayload) => Promise<{ ok: boolean; revision?: number; message?: string }>;
  onRevision: (revision: number) => void;
}) {
  const idleMs = input.idleMs ?? 3_000;
  const maxIntervalMs = input.maxIntervalMs ?? 60_000;
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const dirtyStartedAt = useRef<number | null>(null);
  const latest = useRef(input);
  latest.current = input;

  useEffect(() => {
    if (!input.enabled || !input.dirty) {
      dirtyStartedAt.current = null;
      if (!inFlight.current) setStatus((s) => (s === "error" ? s : "idle"));
      return;
    }
    if (dirtyStartedAt.current === null) dirtyStartedAt.current = Date.now();
    setStatus((s) => (s === "saving" ? s : "scheduled"));

    let cancelled = false;
    const attempt = async () => {
      if (cancelled || inFlight.current) return;
      const snap = latest.current;
      if (!snap.enabled || !snap.dirty) return;
      inFlight.current = true;
      setStatus("saving");
      setError(null);
      try {
        const result = await snap.save({
          expectedRevision: snap.revision,
          title: snap.title,
          body: snap.body,
          fields: snap.fields,
        });
        if (cancelled) return;
        if (result.ok && typeof result.revision === "number") {
          snap.onRevision(result.revision);
          setStatus("saved");
        } else {
          setStatus("error");
          setError(result.message ?? "Autosave failed.");
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setError(err instanceof Error ? err.message : "Autosave failed.");
        }
      } finally {
        inFlight.current = false;
      }
    };

    const idleTimer = window.setTimeout(() => {
      void attempt();
    }, idleMs);

    const elapsed = Date.now() - (dirtyStartedAt.current ?? Date.now());
    const maxTimer = window.setTimeout(() => {
      void attempt();
    }, Math.max(0, maxIntervalMs - elapsed));

    return () => {
      cancelled = true;
      window.clearTimeout(idleTimer);
      window.clearTimeout(maxTimer);
    };
  }, [input.enabled, input.dirty, input.revision, input.title, input.body, input.fields, idleMs, maxIntervalMs]);

  useEffect(() => {
    if (!input.enabled) return;
    const flush = () => {
      const snap = latest.current;
      if (!snap.enabled || !snap.dirty || inFlight.current) return;
      inFlight.current = true;
      setStatus("saving");
      void snap
        .save({
          expectedRevision: snap.revision,
          title: snap.title,
          body: snap.body,
          fields: snap.fields,
        })
        .then((result) => {
          if (result.ok && typeof result.revision === "number") {
            snap.onRevision(result.revision);
            setStatus("saved");
            setError(null);
          } else {
            setStatus("error");
            setError(result.message ?? "Autosave failed.");
          }
        })
        .catch((err) => {
          setStatus("error");
          setError(err instanceof Error ? err.message : "Autosave failed.");
        })
        .finally(() => {
          inFlight.current = false;
        });
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [input.enabled]);

  return { status, error };
}
