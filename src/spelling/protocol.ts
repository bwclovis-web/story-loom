import type { DictionaryWord, SpellFlag } from "./dictionary";

/** Messages between the editor and the spell-check worker (src/spelling/spell.worker.ts). */
export type CheckerRequest =
  | { type: "init"; language: string; affUrl: string; dicUrl: string }
  | { type: "dictionary"; words: DictionaryWord[] }
  | { type: "check"; id: number; text: string }
  | { type: "suggest"; id: number; word: string; limit: number };

export type CheckerResponse =
  | { type: "ready"; loadMs: number }
  | { type: "error"; message: string }
  | { type: "checked"; id: number; flags: SpellFlag[]; ms: number }
  | { type: "suggested"; id: number; suggestions: string[] };
