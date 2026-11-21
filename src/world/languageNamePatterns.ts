import { parseJsonObject, type JsonObject } from "@/domain/json";
import { worldbuildingKindFromFields } from "./worldKinds";

const MAX_SYLLABLES = 128;
const MAX_PATTERNS = 32;
const MAX_SYLLABLE_LEN = 24;
const MAX_PATTERN_LEN = 80;
export const MAX_GENERATED_NAMES = 24;

export interface LanguageNamePatternSet {
  syllables: string[];
  patterns: string[];
}

/** Split author syllable or pattern lists (newline or comma). */
export function splitNameList(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseLanguageNamePatternSet(fields: unknown): LanguageNamePatternSet | null {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  if (worldbuildingKindFromFields(fields) !== "language") return null;
  const obj = fields as JsonObject;
  const syllables = splitNameList(typeof obj.nameSyllables === "string" ? obj.nameSyllables : "")
    .map((s) => s.slice(0, MAX_SYLLABLE_LEN))
    .slice(0, MAX_SYLLABLES);
  const patterns = splitNameList(typeof obj.namePatterns === "string" ? obj.namePatterns : "")
    .map((p) => p.slice(0, MAX_PATTERN_LEN))
    .slice(0, MAX_PATTERNS);
  if (!syllables.length || !patterns.length) return null;
  return { syllables, patterns };
}

function fnv1aSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function capitalizeSyllable(syllable: string): string {
  if (!syllable) return "";
  const lower = syllable.toLocaleLowerCase();
  return lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
}

function expandPattern(pattern: string, syllables: readonly string[], next: () => number): string {
  return pattern.replace(/\{([sS])\}/g, (_match, token: string) => {
    if (!syllables.length) return "";
    const index = Math.min(syllables.length - 1, Math.floor(next() * syllables.length));
    const pick = syllables[index]!;
    return token === "S" ? capitalizeSyllable(pick) : pick;
  });
}

/**
 * Suggestion-only name list. Same seed + pattern set yields the same sequence.
 */
export function generateLanguageNames(
  patternSet: LanguageNamePatternSet,
  input: { count: number; seed: string },
): string[] {
  const count = Math.min(MAX_GENERATED_NAMES, Math.max(1, Math.floor(input.count)));
  const seedText = input.seed.trim() || "wordly";
  const rng = mulberry32(fnv1aSeed(seedText));
  const out: string[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (out.length < count && guard < count * 20) {
    guard += 1;
    const pattern = patternSet.patterns[Math.floor(rng() * patternSet.patterns.length)]!;
    const name = expandPattern(pattern, patternSet.syllables, rng).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Parse fields JSON from the reference editor. */
export function parseLanguageNamePatternSetFromJson(fieldsJson: string): LanguageNamePatternSet | null {
  try {
    return parseLanguageNamePatternSet(parseJsonObject(fieldsJson));
  } catch {
    return null;
  }
}