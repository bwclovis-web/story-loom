import Typo from "typo-js";
import { DictionaryMatcher, findMisspellings } from "./dictionary";
import type { CheckerRequest, CheckerResponse } from "./protocol";
import { createWordChecker } from "./words";

/*
 * Spell checking off the main thread, so typing never waits for it. Loads the
 * standard word list once, then checks whole texts against it and the
 * author's dictionary. Suggestions are slow (about a second per word) and are
 * only made on request.
 */

const ctx = self as unknown as {
  postMessage(message: CheckerResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<CheckerRequest>) => void): void;
};

let typo: Typo | null = null;
let isKnown: ((word: string) => boolean) | null = null;
let matcher = new DictionaryMatcher([]);
let ready: Promise<void> = Promise.reject(new Error("not initialised"));
ready.catch(() => {});

async function load(msg: Extract<CheckerRequest, { type: "init" }>): Promise<void> {
  const started = performance.now();
  const fetchText = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load the ${msg.language} dictionary (HTTP ${res.status}).`);
    return res.text();
  };
  const [aff, dic] = await Promise.all([fetchText(msg.affUrl), fetchText(msg.dicUrl)]);
  typo = new Typo(msg.language, aff, dic);
  isKnown = createWordChecker(typo);
  ctx.postMessage({ type: "ready", loadMs: Math.round(performance.now() - started) });
}

ctx.addEventListener("message", async (event) => {
  const msg = event.data;
  if (msg.type === "init") {
    ready = load(msg);
    ready.catch((e: unknown) => ctx.postMessage({ type: "error", message: e instanceof Error ? e.message : "The dictionary could not be loaded." }));
    return;
  }
  if (msg.type === "dictionary") {
    matcher = new DictionaryMatcher(msg.words);
    return;
  }
  try {
    await ready;
  } catch {
    return;
  }
  if (msg.type === "check") {
    const started = performance.now();
    const flags = findMisspellings(msg.text, isKnown!, matcher);
    ctx.postMessage({ type: "checked", id: msg.id, flags, ms: Math.round(performance.now() - started) });
  } else if (msg.type === "suggest") {
    ctx.postMessage({ type: "suggested", id: msg.id, suggestions: typo!.suggest(msg.word, msg.limit) });
  }
});
