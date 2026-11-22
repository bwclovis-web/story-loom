"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Browser-only read-aloud via speechSynthesis. No server calls and no writes.
 *
 * Chromium quirks handled here:
 * - speak() should stay inside the click gesture when nothing is already speaking
 *   (a delayed speak after every cancel is often blocked with no error).
 * - cancel() then immediate speak() can drop the next utterance; delay only when
 *   we actually canceled an in-flight utterance.
 * - canceled utterances fire onerror; a generation token ignores stale callbacks.
 */
export function useReadAloud(text: string) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const textRef = useRef(text);
  const generationRef = useRef(0);
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  textRef.current = text;

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSupported(false);
      return;
    }
    setSupported(true);
    const warm = () => {
      void window.speechSynthesis.getVoices();
    };
    warm();
    window.speechSynthesis.addEventListener("voiceschanged", warm);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", warm);
  }, []);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const clearTimer = () => {
    if (speakTimerRef.current) {
      clearTimeout(speakTimerRef.current);
      speakTimerRef.current = null;
    }
  };

  const stop = () => {
    generationRef.current += 1;
    clearTimer();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  };

  const speakNow = (clipped: string, rate: number, generation: number) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (generationRef.current !== generation) return;

    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(clipped);
    utterance.rate = Math.min(1.5, Math.max(0.7, rate));
    const voices = synth.getVoices();
    if (voices.length) {
      const preferred =
        voices.find((v) => v.default) ?? voices.find((v) => /^en\b/i.test(v.lang)) ?? voices[0];
      if (preferred) utterance.voice = preferred;
    }
    utterance.onstart = () => {
      if (generationRef.current === generation) setSpeaking(true);
    };
    utterance.onend = () => {
      if (generationRef.current === generation) setSpeaking(false);
    };
    utterance.onerror = () => {
      if (generationRef.current === generation) setSpeaking(false);
    };

    setSpeaking(true);
    try {
      synth.resume();
    } catch {
      /* ignore */
    }
    synth.speak(utterance);

    const keepAlive = window.setInterval(() => {
      if (generationRef.current !== generation || !synth.speaking) {
        window.clearInterval(keepAlive);
        return;
      }
      if (synth.paused) {
        try {
          synth.resume();
        } catch {
          /* ignore */
        }
      }
    }, 8_000);
  };

  const start = (opts?: { rate?: number; text?: string }) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const rate = opts?.rate ?? 1;
    const clipped = (opts?.text ?? textRef.current).trim().slice(0, 12_000);
    if (!clipped) return;

    const synth = window.speechSynthesis;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    clearTimer();

    const busy = synth.speaking || synth.pending;
    if (busy) {
      synth.cancel();
      // Only delay when we interrupted something; keeps the first click in-gesture.
      speakTimerRef.current = setTimeout(() => {
        speakTimerRef.current = null;
        speakNow(clipped, rate, generation);
      }, 50);
      return;
    }

    speakNow(clipped, rate, generation);
  };

  return { supported, speaking, start, stop };
}
