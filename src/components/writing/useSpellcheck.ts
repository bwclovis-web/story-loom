"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DictionaryWord, SpellFlag } from "@/spelling/dictionary";
import type { CheckerRequest, CheckerResponse } from "@/spelling/protocol";
import { mapRanges } from "@/spelling/ranges";
import type { SpellingLanguage } from "@/writing/spelling";

/** Pause in typing before the text is checked again. */
export const CHECK_DELAY_MS = 300;

export type SpellcheckStatus = "off" | "loading" | "ready" | "error";

export interface Spellcheck {
  status: SpellcheckStatus;
  error: string;
  /** Milliseconds the last check took in the worker. */
  lastCheckMs: number | null;
  /** Flags moved onto `text` (words edited since the last check are left out until the next one). */
  flagsFor: (text: string) => SpellFlag[];
  ignoreOnce: (flag: SpellFlag, text: string) => void;
  suggest: (word: string) => Promise<string[]>;
}

function createWorker(): Worker {
  return new Worker(new URL("../../spelling/spell.worker.ts", import.meta.url));
}

function dictionaryUrls(language: SpellingLanguage) {
  return { affUrl: `/api/spelling/${language}/aff`, dicUrl: `/api/spelling/${language}/dic` };
}

export function useSpellcheck({
  enabled,
  language,
  text,
  words,
}: {
  enabled: boolean;
  language: SpellingLanguage;
  text: string;
  words: readonly DictionaryWord[];
}): Spellcheck {
  const [status, setStatus] = useState<SpellcheckStatus>(enabled ? "loading" : "off");
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<{ text: string; flags: SpellFlag[] }>({ text: "", flags: [] });
  const [ignored, setIgnored] = useState<{ base: string; ranges: SpellFlag[] }>({ base: "", ranges: [] });
  const [lastCheckMs, setLastCheckMs] = useState<number | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const suggesterRef = useRef<Worker | null>(null);
  const textRef = useRef(text);
  const sentRef = useRef(new Map<number, string>());
  const nextId = useRef(1);
  const latestId = useRef(0);
  const pendingSuggest = useRef(new Map<number, (s: string[]) => void>());
  const wordsRef = useRef(words);
  const statusRef = useRef(status);

  useLayoutEffect(() => {
    textRef.current = text;
    wordsRef.current = words;
    statusRef.current = status;
  });

  const requestCheck = useCallback(() => {
    const worker = workerRef.current;
    if (!worker) return;
    const id = nextId.current++;
    latestId.current = id;
    sentRef.current.set(id, textRef.current);
    worker.postMessage({ type: "check", id, text: textRef.current } satisfies CheckerRequest);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus("off");
      return;
    }
    setStatus("loading");
    setError("");
    const worker = createWorker();
    workerRef.current = worker;
    const sent = sentRef.current;
    worker.onmessage = (event: MessageEvent<CheckerResponse>) => {
      const msg = event.data;
      if (msg.type === "ready") {
        setStatus("ready");
        requestCheck();
      } else if (msg.type === "error") {
        setStatus("error");
        setError(msg.message);
      } else if (msg.type === "checked") {
        const checkedText = sent.get(msg.id);
        sent.delete(msg.id);
        if (msg.id !== latestId.current || checkedText === undefined) return;
        setChecked({ text: checkedText, flags: msg.flags });
        setLastCheckMs(msg.ms);
        // Keep ignored words in step with the text, so old positions never pile up.
        setIgnored((prev) => ({ base: textRef.current, ranges: mapRanges(prev.base, textRef.current, prev.ranges) }));
      }
    };
    worker.onerror = () => {
      setStatus("error");
      setError("The spell checker stopped unexpectedly. Reload the page to start it again.");
    };
    worker.postMessage({ type: "dictionary", words: [...wordsRef.current] } satisfies CheckerRequest);
    worker.postMessage({ type: "init", language, ...dictionaryUrls(language) } satisfies CheckerRequest);
    return () => {
      worker.terminate();
      workerRef.current = null;
      sent.clear();
      suggesterRef.current?.terminate();
      suggesterRef.current = null;
      for (const resolve of pendingSuggest.current.values()) resolve([]);
      pendingSuggest.current.clear();
    };
  }, [enabled, language, requestCheck]);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    worker.postMessage({ type: "dictionary", words: [...words] } satisfies CheckerRequest);
    if (statusRef.current === "ready") requestCheck();
  }, [words, requestCheck]);

  useEffect(() => {
    if (status !== "ready") return;
    const timer = setTimeout(requestCheck, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, status, requestCheck]);

  const flagsFor = useCallback(
    (target: string) => {
      const flags = mapRanges(checked.text, target, checked.flags);
      if (ignored.ranges.length === 0) return flags;
      const skip = new Set(mapRanges(ignored.base, target, ignored.ranges).map((r) => `${r.start}:${r.end}`));
      return flags.filter((f) => !skip.has(`${f.start}:${f.end}`));
    },
    [checked, ignored],
  );

  const ignoreOnce = useCallback((flag: SpellFlag, current: string) => {
    setIgnored((prev) => ({ base: current, ranges: [...mapRanges(prev.base, current, prev.ranges), flag] }));
  }, []);

  const suggest = useCallback(
    (word: string) => {
      if (!enabled) return Promise.resolve([]);
      let worker = suggesterRef.current;
      if (!worker) {
        worker = createWorker();
        suggesterRef.current = worker;
        worker.onmessage = (event: MessageEvent<CheckerResponse>) => {
          const msg = event.data;
          if (msg.type === "suggested") {
            pendingSuggest.current.get(msg.id)?.(msg.suggestions);
            pendingSuggest.current.delete(msg.id);
          } else if (msg.type === "error") {
            for (const resolve of pendingSuggest.current.values()) resolve([]);
            pendingSuggest.current.clear();
          }
        };
        worker.postMessage({ type: "init", language, ...dictionaryUrls(language) } satisfies CheckerRequest);
      }
      const id = nextId.current++;
      const w = worker;
      return new Promise<string[]>((resolve) => {
        pendingSuggest.current.set(id, resolve);
        w.postMessage({ type: "suggest", id, word, limit: 6 } satisfies CheckerRequest);
      });
    },
    [enabled, language],
  );

  return { status, error, lastCheckMs, flagsFor, ignoreOnce, suggest };
}
