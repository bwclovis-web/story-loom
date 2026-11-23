/**
 * Deterministic manuscript-passage vs approved world-fact comparison (W7B).
 * Domain-only: no DB imports. Undated / conflicted / planned facts are never
 * treated as contradiction grounds. Non-assertive belief/uncertainty/dialogue
 * does not contradict objective world state.
 */

import { resolveQuotation } from "@/analyze/chapterAnalysisReview";
import { sha256 } from "@/domain/json";
import {
  formatWorldProfileFieldValue,
  isWorldProfileGlossedLines,
  isWorldProfileQuantity,
  type WorldProfileFieldValue,
  type WorldProfileQuantity,
  type WorldQuantityQualifier,
} from "@/domain/worldProfile";
import { isDescriptiveSubcategoryField } from "@/world/worldProfileRegistry";
import type { WorldContextFact } from "@/domain/worldWritingContext";

export const PASSAGE_STANCES = ["narration", "dialogue", "belief", "uncertainty"] as const;
export type PassageStance = (typeof PASSAGE_STANCES)[number];

export const CONTRADICTION_VERDICTS = [
  "conflict",
  "ambiguous",
  "compatible",
  "non_assertive",
  "insufficient_evidence",
  "scope_mismatch",
] as const;
export type ContradictionVerdict = (typeof CONTRADICTION_VERDICTS)[number];

export interface WorldFactSnapshot {
  worldRecordId: string;
  worldTitle: string;
  worldAliases?: readonly string[];
  fieldPath: string;
  /** Taxonomy subcategory hint for scope guards (e.g. cities_and_settlements). */
  subcategoryId?: string | null;
  changeId: string;
  worldRecordRevision: number;
  value: WorldProfileFieldValue;
  formatted: string;
  storyPointLabel: string;
}

export interface PassageClaim {
  text: string;
  start: number;
  end: number;
  stance: PassageStance;
}

export interface ContradictionEvaluation {
  verdict: ContradictionVerdict;
  stance: PassageStance;
  explanation: string;
  passage: PassageClaim;
  worldFact: WorldFactSnapshot;
  issueKey: string;
  dedupeKey: string;
  passageHash: string;
}

export interface AiContradictionCandidate {
  excerpt: string;
  occurrence?: number;
  worldRecordId: string;
  fieldPath: string;
  changeId?: string | null;
  worldRecordRevision?: number | null;
}

const BELIEF_RE =
  /\b(believed|believe|thought|thinks|assumed|convinced|insisted|heard|rumou?red|supposed|knew that|knows that)\b/i;
const UNCERTAINTY_RE =
  /\b(hoped|hopes|wished|wondered|perhaps|maybe|might|doubted|feared|if only|prayed)\b/i;
const DIALOGUE_TAG_RE =
  /\b(said|asked|replied|whispered|muttered|shouted|cried|answered|called)\b/i;

const ENTRY_RE =
  /\b(entered|passed through|walked through|went through|crossed|used|slipped through|came through)\b/i;
const WAS_OPEN_RE = /\b(was open|stood open|remained open|is open|were open)\b/i;
const SEALED_RE = /\b(was (sealed|locked|barred|closed)|stood sealed|impassable|shut tight)\b/i;

const REGION_SCOPE_RE = /\b(region|province|surrounding|countryside|district|territory)\b/i;
const SETTLEMENT_SCOPE_RE = /\b(town|city|village|settlement|harbor|harbour|station)\b/i;
const STRETCH_SCOPE_RE = /\b(navigable stretch|lower reach|upper reach|stretch|reach of)\b/i;

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  none: 0,
  no: 0,
  uninhabited: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
};

/** Length → km; area → km². */
const LENGTH_TO_KM: Record<string, number> = {
  km: 1,
  kilometer: 1,
  kilometers: 1,
  kilometre: 1,
  kilometres: 1,
  mile: 1.609344,
  miles: 1.609344,
  mi: 1.609344,
  league: 4.828032,
  leagues: 4.828032,
};

const AREA_TO_KM2: Record<string, number> = {
  "km²": 1,
  km2: 1,
  "sq km": 1,
  "square kilometers": 1,
  "square kilometres": 1,
  "sq mi": 2.589988,
  "square miles": 2.589988,
  acre: 0.00404686,
  acres: 0.00404686,
  hectare: 0.01,
  hectares: 0.01,
  "leagues²": 23.3099,
  leagues2: 23.3099,
};

export function classifyPassageStance(text: string): PassageStance {
  const trimmed = text.trim();
  if (!trimmed) return "narration";
  const quoteCount = (trimmed.match(/["“”']/g) ?? []).length;
  if (quoteCount >= 2 || DIALOGUE_TAG_RE.test(trimmed)) return "dialogue";
  if (UNCERTAINTY_RE.test(trimmed)) return "uncertainty";
  if (BELIEF_RE.test(trimmed)) return "belief";
  return "narration";
}

export function splitPassageClaims(body: string): PassageClaim[] {
  const claims: PassageClaim[] = [];
  const re = /[^.!?\n]+[.!?]?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const text = match[0];
    const trimmed = text.trim();
    if (!trimmed) continue;
    const lead = text.match(/^\s*/)?.[0].length ?? 0;
    const start = match.index + lead;
    const end = start + trimmed.length;
    claims.push({
      text: trimmed,
      start,
      end,
      stance: classifyPassageStance(trimmed),
    });
  }
  return claims;
}

export function worldContradictionIssueKey(input: {
  manuscriptRecordId: string;
  worldRecordId: string;
  fieldPath: string;
  passageHash: string;
}): string {
  return `world_contradiction:${input.manuscriptRecordId}:${input.worldRecordId}:${input.fieldPath}:${input.passageHash}`;
}

export function worldContradictionDedupeKey(input: {
  manuscriptRecordId: string;
  manuscriptRevision: number;
  passageHash: string;
  worldRecordId: string;
  worldRecordRevision: number;
  fieldPath: string;
  changeId: string;
}): string {
  return [
    input.manuscriptRecordId,
    String(input.manuscriptRevision),
    input.passageHash,
    input.worldRecordId,
    String(input.worldRecordRevision),
    input.fieldPath,
    input.changeId,
  ].join(":");
}

function mentionsEntity(text: string, fact: WorldFactSnapshot): boolean {
  const forms = [fact.worldTitle, ...(fact.worldAliases ?? [])]
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  if (!forms.length) return true;
  const lower = text.toLowerCase();
  return forms.some((form) => lower.includes(form.toLowerCase()));
}

function scopeMismatch(text: string, fact: WorldFactSnapshot): string | null {
  const field = fact.fieldPath.replace(/^values\./, "").replace(/^fields\./, "");
  if (field === "populationEstimate") {
    const sub = fact.subcategoryId ?? "";
    if (sub === "cities_and_settlements" && REGION_SCOPE_RE.test(text) && !SETTLEMENT_SCOPE_RE.test(text)) {
      return "Passage refers to a region, not this settlement's population.";
    }
    if (sub === "regions" && SETTLEMENT_SCOPE_RE.test(text) && !REGION_SCOPE_RE.test(text)) {
      return "Passage refers to a settlement, not this region's population.";
    }
  }
  if (field === "length" && STRETCH_SCOPE_RE.test(text)) {
    return "Passage refers to a navigable stretch, not the whole waterway length.";
  }
  return null;
}

function parseNumberToken(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim().toLowerCase();
  if (!cleaned) return null;
  if (cleaned in NUMBER_WORDS) return NUMBER_WORDS[cleaned]!;
  if (/^\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);
  const compound = cleaned.match(/^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[-\s](one|two|three|four|five|six|seven|eight|nine)$/);
  if (compound) {
    return (NUMBER_WORDS[compound[1]!] ?? 0) + (NUMBER_WORDS[compound[2]!] ?? 0);
  }
  const thousands = cleaned.match(/^(twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\s+thousand$/);
  if (thousands) return (NUMBER_WORDS[thousands[1]!] ?? 0) * 1000;
  return null;
}

function parsePassageQuantity(text: string): {
  amount: number;
  unit?: string;
  qualifier: WorldQuantityQualifier;
} | null {
  const lower = text.toLowerCase();
  let qualifier: WorldQuantityQualifier = "exact";
  if (/\b(about|roughly|approximately|around|nearly|circa)\b/.test(lower)) qualifier = "about";
  else if (/\b(at least|more than|over|no fewer than)\b/.test(lower)) qualifier = "at_least";
  else if (/\b(at most|fewer than|less than|under|no more than)\b/.test(lower)) qualifier = "at_most";

  if (/\b(uninhabited|no permanent residents|no residents|nobody lived|none lived)\b/.test(lower)) {
    return { amount: 0, qualifier };
  }

  const ones = "one|two|three|four|five|six|seven|eight|nine";
  const numeric = lower.match(
    new RegExp(
      `(-?\\d[\\d,]*(?:\\.\\d+)?|zero|none|\\bno\\b|${ones}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[-\\s](?:${ones}))?|thirty(?:[-\\s](?:${ones}))?|forty(?:[-\\s](?:${ones}))?|fifty(?:[-\\s](?:${ones}))?|sixty(?:[-\\s](?:${ones}))?|seventy(?:[-\\s](?:${ones}))?|eighty(?:[-\\s](?:${ones}))?|ninety(?:[-\\s](?:${ones}))?|\\w+\\s+thousand)\\s*(miles?|mi|km|kilometers?|kilometres?|leagues?|sq\\s*mi|km²|km2|acres?|hectares?|residents?|people|inhabitants?)?`,
      "i",
    ),
  );
  if (!numeric) return null;
  const amount = parseNumberToken(numeric[1] ?? "");
  if (amount === null || !Number.isFinite(amount)) return null;
  const unitRaw = (numeric[2] ?? "").trim().toLowerCase();
  const unit = unitRaw || undefined;
  return { amount, unit, qualifier };
}

function normalizeUnitKey(unit: string | undefined): string {
  return (unit ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toCanonicalQuantity(
  amount: number,
  unit: string | undefined,
): { kind: "length" | "area" | "count" | "unknown"; value: number } | null {
  const key = normalizeUnitKey(unit);
  if (!key || /^(residents?|people|inhabitants?)$/.test(key)) {
    return { kind: "count", value: amount };
  }
  if (key in LENGTH_TO_KM) return { kind: "length", value: amount * LENGTH_TO_KM[key]! };
  if (key in AREA_TO_KM2) return { kind: "area", value: amount * AREA_TO_KM2[key]! };
  // bare number treated as count
  return { kind: "unknown", value: amount };
}

function relativeDelta(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / denom;
}

function compareQuantities(
  factQty: WorldProfileQuantity,
  claim: { amount: number; unit?: string; qualifier: WorldQuantityQualifier },
): ContradictionVerdict {
  const left = toCanonicalQuantity(factQty.amount, factQty.unit);
  const right = toCanonicalQuantity(claim.amount, claim.unit);
  if (!left || !right) return "insufficient_evidence";
  if (left.kind !== right.kind && left.kind !== "unknown" && right.kind !== "unknown") {
    return "scope_mismatch";
  }

  const factQ = factQty.qualifier ?? "exact";
  const claimQ = claim.qualifier;

  // Documented zero vs positive population.
  if (factQty.amount === 0 && (factQ === "exact" || factQ === "at_most") && claim.amount > 0) {
    return "conflict";
  }
  if (claim.amount === 0 && factQty.amount > 0 && (claimQ === "exact" || claimQ === "at_most")) {
    return "conflict";
  }

  if (factQ === "at_least" && claim.amount < factQty.amount && claimQ !== "at_least") {
    return "conflict";
  }
  if (factQ === "at_most" && claim.amount > factQty.amount && claimQ !== "at_most") {
    return "conflict";
  }
  if (claimQ === "at_least" && factQty.amount < claim.amount && factQ !== "at_least") {
    // Claim says at least X; fact is lower exact → conflict when fact is exact/at_most.
    if (factQ === "exact" || factQ === "at_most") return "conflict";
  }
  if (claimQ === "at_most" && factQty.amount > claim.amount && (factQ === "exact" || factQ === "at_least")) {
    return "conflict";
  }

  const delta = relativeDelta(left.value, right.value);
  const aboutInPlay = factQ === "about" || claimQ === "about";
  if (aboutInPlay) {
    if (delta <= 0.1) return "compatible";
    if (delta <= 0.35) return "ambiguous";
    return "conflict";
  }
  if (delta <= 0.02) return "compatible";
  if (delta <= 0.1) return "ambiguous";
  return "conflict";
}

function compareAccess(factValue: WorldProfileFieldValue, text: string): ContradictionVerdict | null {
  const factText = formatWorldProfileFieldValue(factValue).trim().toLowerCase();
  if (!factText) return null;
  const closed = /\b(closed|sealed|locked|barred)\b/.test(factText);
  const open = /\bopen\b/.test(factText);
  if (closed && (ENTRY_RE.test(text) || WAS_OPEN_RE.test(text))) return "conflict";
  if (open && SEALED_RE.test(text)) return "conflict";
  if (closed && SEALED_RE.test(text)) return "compatible";
  if (open && (ENTRY_RE.test(text) || WAS_OPEN_RE.test(text))) return "compatible";
  return null;
}

function explanationFor(
  verdict: ContradictionVerdict,
  passage: PassageClaim,
  fact: WorldFactSnapshot,
): string {
  switch (verdict) {
    case "conflict":
      return `Narration asserts something incompatible with the approved ${fact.formatted} for ${fact.worldTitle} at this story point.`;
    case "ambiguous":
      return `The passage estimate may conflict with approved ${fact.formatted} for ${fact.worldTitle}; judge the tolerance for “about.”`;
    case "compatible":
      return `The passage is compatible with approved ${fact.formatted} for ${fact.worldTitle}.`;
    case "non_assertive":
      return `The passage does not assert objective world state (stance: ${passage.stance}).`;
    case "scope_mismatch":
      return `The passage and the world field refer to different scopes for ${fact.worldTitle}.`;
    case "insufficient_evidence":
      return `No approved, dated, unambiguous world fact is available to compare at this story point.`;
    default:
      return "";
  }
}

/**
 * Compare one passage claim against one eligible world fact snapshot.
 * Caller must only pass W5C/W7A-eligible facts (approved, set, unplanned).
 */
export function evaluatePassageAgainstWorldFact(input: {
  passage: PassageClaim;
  fact: WorldFactSnapshot;
  manuscriptRecordId: string;
  manuscriptRevision: number;
}): ContradictionEvaluation {
  const { passage, fact } = input;
  const passageHash = sha256(passage.text);
  const issueKey = worldContradictionIssueKey({
    manuscriptRecordId: input.manuscriptRecordId,
    worldRecordId: fact.worldRecordId,
    fieldPath: fact.fieldPath,
    passageHash,
  });
  const dedupeKey = worldContradictionDedupeKey({
    manuscriptRecordId: input.manuscriptRecordId,
    manuscriptRevision: input.manuscriptRevision,
    passageHash,
    worldRecordId: fact.worldRecordId,
    worldRecordRevision: fact.worldRecordRevision,
    fieldPath: fact.fieldPath,
    changeId: fact.changeId,
  });

  const base = {
    stance: passage.stance,
    passage,
    worldFact: fact,
    issueKey,
    dedupeKey,
    passageHash,
  };

  if (passage.stance === "belief" || passage.stance === "uncertainty" || passage.stance === "dialogue") {
    // Dialogue can still assert facts, but hope/belief never does.
    if (passage.stance !== "dialogue" || UNCERTAINTY_RE.test(passage.text) || BELIEF_RE.test(passage.text)) {
      return {
        ...base,
        verdict: "non_assertive",
        explanation: explanationFor("non_assertive", passage, fact),
      };
    }
  }

  const fieldKey = fact.fieldPath.replace(/^values\./, "").replace(/^fields\./, "");
  if (isDescriptiveSubcategoryField(fieldKey) || isWorldProfileGlossedLines(fact.value)) {
    return {
      ...base,
      verdict: "insufficient_evidence",
      explanation:
        "Descriptive prose and sample utterances stay notes; they are not contradiction rules.",
    };
  }

  if (!mentionsEntity(passage.text, fact) && fact.fieldPath !== "values.access") {
    // Access claims often name a feature (east door) rather than the place title.
    if (!(fact.fieldPath.endsWith(".access") && (ENTRY_RE.test(passage.text) || WAS_OPEN_RE.test(passage.text) || SEALED_RE.test(passage.text)))) {
      return {
        ...base,
        verdict: "insufficient_evidence",
        explanation: explanationFor("insufficient_evidence", passage, fact),
      };
    }
  }

  const scope = scopeMismatch(passage.text, fact);
  if (scope) {
    return { ...base, verdict: "scope_mismatch", explanation: scope };
  }

  if (fact.value === null || fact.value === undefined || fact.value === "") {
    return {
      ...base,
      verdict: "insufficient_evidence",
      explanation: explanationFor("insufficient_evidence", passage, fact),
    };
  }

  const field = fact.fieldPath.replace(/^values\./, "").replace(/^fields\./, "");
  let verdict: ContradictionVerdict = "insufficient_evidence";

  if (field === "access") {
    verdict = compareAccess(fact.value, passage.text) ?? "insufficient_evidence";
  } else if (isWorldProfileQuantity(fact.value) || field === "populationEstimate" || field === "landArea" || field === "length") {
    const qty = isWorldProfileQuantity(fact.value)
      ? fact.value
      : typeof fact.value === "number"
        ? { amount: fact.value }
        : null;
    const claim = parsePassageQuantity(passage.text);
    if (!qty || !claim) {
      verdict = "insufficient_evidence";
    } else {
      verdict = compareQuantities(qty, claim);
    }
  } else if (typeof fact.value === "string") {
    const factLower = fact.value.toLowerCase();
    const passageLower = passage.text.toLowerCase();
    if (factLower && passageLower.includes(factLower)) verdict = "compatible";
  }

  return {
    ...base,
    verdict,
    explanation: explanationFor(verdict, passage, fact),
  };
}

export function validateAiContradictionCandidate(input: {
  body: string;
  candidate: AiContradictionCandidate;
  eligibleFacts: readonly WorldFactSnapshot[];
}): { ok: true; start: number; end: number; excerpt: string } | { ok: false; reason: string } {
  const excerpt = input.candidate.excerpt.trim();
  if (!excerpt) return { ok: false, reason: "The quotation is empty." };
  const resolved = resolveQuotation(input.body, excerpt, input.candidate.occurrence ?? 1);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  const match = input.eligibleFacts.find(
    (fact) =>
      fact.worldRecordId === input.candidate.worldRecordId &&
      fact.fieldPath === input.candidate.fieldPath &&
      (!input.candidate.changeId || fact.changeId === input.candidate.changeId) &&
      (input.candidate.worldRecordRevision == null ||
        fact.worldRecordRevision === input.candidate.worldRecordRevision),
  );
  if (!match) {
    return { ok: false, reason: "The cited world fact is not eligible at this story point." };
  }
  return { ok: true, start: resolved.start, end: resolved.end, excerpt: resolved.excerpt };
}

/** Build a WorldFactSnapshot from a W7A WorldContextFact plus record metadata. */
export function snapshotFromContextFact(
  fact: WorldContextFact,
  meta: {
    worldRecordId: string;
    worldTitle: string;
    worldAliases?: readonly string[];
    worldRecordRevision: number;
    value: WorldProfileFieldValue;
    subcategoryId?: string | null;
    storyPointLabel: string;
  },
): WorldFactSnapshot {
  return {
    worldRecordId: meta.worldRecordId,
    worldTitle: meta.worldTitle,
    worldAliases: meta.worldAliases,
    fieldPath: fact.fieldPath,
    subcategoryId: meta.subcategoryId,
    changeId: fact.changeId,
    worldRecordRevision: meta.worldRecordRevision,
    value: meta.value,
    formatted: fact.formatted || formatWorldProfileFieldValue(meta.value),
    storyPointLabel: meta.storyPointLabel,
  };
}

export function findingsToPersist(
  evaluations: readonly ContradictionEvaluation[],
): ContradictionEvaluation[] {
  return evaluations.filter((item) => item.verdict === "conflict" || item.verdict === "ambiguous");
}
