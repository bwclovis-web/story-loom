import {
  CHARACTER_DEVELOPMENT_KEY,
  emptyBookState,
  emptyLivedExperience,
  forgottenArcs,
  knowledgeWindowOpen,
  readCharacterDevelopment,
  resolveCharacterState,
  resolveKnowledgeAtPoint,
  withCharacterDevelopment,
  type CharacterDevelopment,
  type ContextSlice,
  type KnowledgeHolder,
  type KnowledgeItem,
  type NarrativePoint,
  type StateConflict,
} from "@/domain/characterDevelopment";
import { DOSSIER_MARKDOWN_ARCHIVE_KEY } from "@/domain/characterDossierUpgrade";
import type { JsonObject } from "@/domain/json";
import type { OrderEdge } from "@/world/storyOrder";

/*
 * Writing-task character context: which slice, which knowledge holders, and
 * which planned/future material may appear. Keeps spoilers and future plans
 * out of earlier-scene drafting unless the author opts in.
 */

export const WRITING_CONTEXT_MODES = ["drafting", "editorial", "planning"] as const;
export type WritingContextMode = (typeof WRITING_CONTEXT_MODES)[number];

export const CHARACTER_CONTINUITY_KINDS = [
  "character_state_conflict",
  "character_knowledge",
  "character_limitation",
  "forgotten_arc",
  "character_identity",
] as const;
export type CharacterContinuityKind = (typeof CHARACTER_CONTINUITY_KINDS)[number];

export interface WritingContextPolicy {
  mode: WritingContextMode;
  slice: ContextSlice;
  /** Holders allowed into AI context. Empty = none. */
  knowledgeHolders: readonly KnowledgeHolder[];
  /** Include planned (not yet established) knowledge and arcs, labeled as plans. */
  includePlanned: boolean;
  /** Include spoiler-visibility knowledge (also requires slice "spoiler" or planning). */
  includeSpoilers: boolean;
}

export function writingContextPolicy(mode: WritingContextMode, allowFuturePlans = false): WritingContextPolicy {
  if (mode === "drafting") {
    return {
      mode,
      slice: "dialogue",
      knowledgeHolders: ["character", "both"],
      includePlanned: false,
      includeSpoilers: false,
    };
  }
  if (mode === "planning" || allowFuturePlans) {
    return {
      mode: "planning",
      slice: "spoiler",
      knowledgeHolders: ["character", "reader", "both"],
      includePlanned: true,
      includeSpoilers: true,
    };
  }
  return {
    mode: "editorial",
    slice: "continuity",
    knowledgeHolders: ["character", "reader", "both"],
    includePlanned: false,
    includeSpoilers: false,
  };
}

export function filterKnowledgeForWriting(
  items: readonly KnowledgeItem[],
  policy: WritingContextPolicy,
): KnowledgeItem[] {
  return items.filter((item) => {
    if (item.aiVisibility === "omit") return false;
    if (item.aiVisibility === "spoiler" && !policy.includeSpoilers && policy.slice !== "spoiler") return false;
    if (item.planned && !policy.includePlanned) return false;
    if (!policy.knowledgeHolders.includes(item.holder)) return false;
    return true;
  });
}

export interface CharacterContinuityFinding {
  key: string;
  kind: CharacterContinuityKind;
  severity: "info" | "warn" | "error";
  title: string;
  detail: string;
  characterRecordId: string;
  applicableCanon: string;
  explanation: string;
  evidence: string;
  suggestion: string;
  storyLocation: string;
}

function conflictFinding(
  characterId: string,
  title: string,
  conflict: StateConflict,
): CharacterContinuityFinding {
  return {
    key: `character_state_conflict:${characterId}:${conflict.facet}:${conflict.changeIds.join(",")}`,
    kind: "character_state_conflict",
    severity: "warn",
    title,
    detail: `${conflict.facet}: ${conflict.reason}`,
    characterRecordId: characterId,
    applicableCanon: `Approved ${conflict.facet} state changes`,
    explanation:
      "Two or more approved state changes could not be ordered at this story point. This may be a timeline gap, not a forced rewrite.",
    evidence: conflict.changeIds.join(", "),
    suggestion: "Order the events or supersede one change with a correction. Personality archetypes are not rules.",
    storyLocation: conflict.facet,
  };
}

/**
 * Deterministic character continuity findings at a narrative point.
 * Distinguishes unresolved ordering from hard errors. Does not rewrite prose.
 */
export function collectCharacterContinuityFindings(input: {
  characterRecordId: string;
  characterTitle: string;
  profile: CharacterDevelopment;
  point: NarrativePoint;
  edges?: readonly OrderEdge[];
}): CharacterContinuityFinding[] {
  const edges = input.edges ?? [];
  const findings: CharacterContinuityFinding[] = [];
  const state = resolveCharacterState(input.profile, input.point, edges);
  const hasPointAnchor = Boolean(
    input.point.storyEventId ||
      input.point.chapterRecordId ||
      input.point.sceneRecordId ||
      input.point.sequence !== null,
  );
  for (const conflict of state.conflicts) {
    findings.push(conflictFinding(input.characterRecordId, input.characterTitle, conflict));
  }
  for (const changeId of state.unplacedChangeIds) {
    const change = input.profile.stateChanges.find((item) => item.id === changeId);
    if (!change || change.approval !== "approved" || change.planned) continue;
    const changeHasAnchor = Boolean(
      change.storyEventId || change.chapterRecordId || change.sceneRecordId || change.sequence !== null,
    );
    // Project-wide Continuity Ledger (no focus point) should not flag properly anchored changes as unplaced.
    if (!hasPointAnchor && changeHasAnchor) continue;
    findings.push({
      key: `character_limitation:${input.characterRecordId}:${changeId}`,
      kind: "character_limitation",
      severity: "info",
      title: input.characterTitle,
      detail: changeHasAnchor
        ? `Approved ${change.facet} change could not be ordered relative to this story point.`
        : `Approved ${change.facet} change is not placed on the timeline yet.`,
      characterRecordId: input.characterRecordId,
      applicableCanon: `Approved ${change.facet}: ${change.text || "(state change)"}`,
      explanation: changeHasAnchor
        ? "This change has a timeline/chapter anchor, but no story-event order connects it to the current focus point."
        : "The change is canon but has no story-event or chapter anchor yet. Growth or a temporary reaction may still be fine.",
      evidence: change.note || change.text || change.facet,
      suggestion: changeHasAnchor
        ? "Link the story events in Timeline order if ordering matters here, or mark the finding intentional."
        : "Link the change to a story event, chapter, or scene, or mark the Continuity finding intentional.",
      storyLocation: change.storyEventId ?? change.sceneRecordId ?? change.chapterRecordId ?? change.bookProjectId ?? "unplaced",
    });
  }

  const knowledge = resolveKnowledgeAtPoint(input.profile, input.point, edges);
  const secretsWithoutAnchor = input.profile.knowledge.filter(
    (item) =>
      item.approval === "approved" &&
      !item.planned &&
      item.kind === "secret" &&
      item.holder === "character" &&
      !item.fromStoryEventId &&
      !item.sceneRecordId &&
      !knowledge.some((open) => open.id === item.id),
  );
  for (const secret of secretsWithoutAnchor) {
    findings.push({
      key: `character_knowledge:${input.characterRecordId}:${secret.id}`,
      kind: "character_knowledge",
      severity: "info",
      title: input.characterTitle,
      detail: `Secret without a story anchor: ${secret.statement.slice(0, 120)}`,
      characterRecordId: input.characterRecordId,
      applicableCanon: `Character-held secret (${secret.aiVisibility})`,
      explanation:
        "A character should not automatically know bible facts. This secret has no from-event or scene, so drafting context will omit it until anchored.",
      evidence: secret.statement,
      suggestion: "Set when the character learns it (story event or scene), or keep it as author-only with visibility omit.",
      storyLocation: secret.bookProjectId ?? "unanchored",
    });
  }

  for (const arc of forgottenArcs(input.profile)) {
    findings.push({
      key: `forgotten_arc:${input.characterRecordId}:${arc.id}`,
      kind: "forgotten_arc",
      severity: "info",
      title: input.characterTitle,
      detail: `Arc “${arc.title}” has no recent manuscript-linked milestone.`,
      characterRecordId: input.characterRecordId,
      applicableCanon: `Approved arc (${arc.scope})`,
      explanation: "This is a planning cue, not proof the prose is wrong. Intentional quiet arcs can be marked intentional.",
      evidence: arc.title,
      suggestion: "Add a milestone, link a scene, or mark the finding intentional.",
      storyLocation: arc.bookProjectId ?? "series",
    });
  }

  if (input.profile.variant?.foundationRecordId && input.profile.variant.inheritedKeys.length === 0) {
    findings.push({
      key: `character_identity:${input.characterRecordId}:variant`,
      kind: "character_identity",
      severity: "info",
      title: input.characterTitle,
      detail: "Variant identity has a foundation but inherits no traits yet.",
      characterRecordId: input.characterRecordId,
      applicableCanon: `Variant (${input.profile.variant.relationshipKind.replaceAll("_", " ")})`,
      explanation: "Alternate identities keep independent histories; inheritance is optional and explicit.",
      evidence: input.profile.variant.foundationRecordId,
      suggestion: "Tick inherited traits when this variant should share baseline voice or identity.",
      storyLocation: input.point.bookProjectId ?? "series",
    });
  }

  return findings;
}

export interface AssembledCharacterContextMeta {
  characterRecordId: string;
  title: string;
  slice: ContextSlice;
  mode: WritingContextMode;
  point: NarrativePoint;
  omittedSpoilers: number;
  omittedPlanned: number;
  omittedOtherHolders: number;
  knowledgeCount: number;
  stateConflicts: number;
}

export function summarizeKnowledgeOmissions(
  profile: CharacterDevelopment,
  point: NarrativePoint,
  edges: readonly OrderEdge[],
  policy: WritingContextPolicy,
): Pick<AssembledCharacterContextMeta, "omittedSpoilers" | "omittedPlanned" | "omittedOtherHolders" | "knowledgeCount"> {
  const atPoint = resolveKnowledgeAtPoint(profile, point, edges);
  const planned = profile.knowledge.filter((item) => item.approval === "approved" && item.planned);
  const included = filterKnowledgeForWriting(
    policy.includePlanned ? [...atPoint, ...planned] : atPoint,
    policy,
  );
  const omittedSpoilers = atPoint.filter((item) => item.aiVisibility === "spoiler" && !policy.includeSpoilers).length;
  const omittedPlanned = planned.filter((item) => !policy.includePlanned).length;
  const omittedOtherHolders = atPoint.filter(
    (item) => item.aiVisibility !== "omit" && !policy.knowledgeHolders.includes(item.holder),
  ).length;
  return {
    omittedSpoilers,
    omittedPlanned,
    omittedOtherHolders,
    knowledgeCount: included.length,
  };
}

/**
 * Fallback narrative book order for series dossiers whose bookStates do not set
 * narrativeIndex explicitly. Never overrides author-chosen narrativeIndex values.
 */
export function withSeriesBookOrderFallback(
  profile: CharacterDevelopment,
  bookIds: readonly string[],
): CharacterDevelopment {
  if (bookIds.length <= 1) return profile;
  if (profile.bookStates.some((book) => book.narrativeIndex !== null)) return profile;
  const byId = new Map(profile.bookStates.map((book) => [book.projectId, book]));
  const bookStates = bookIds.map((id, index) => ({
    ...(byId.get(id) ?? emptyBookState(id)),
    narrativeIndex: index,
  }));
  return { ...profile, bookStates };
}

/**
 * Optionally strips lived-experience notes, omit/spoiler knowledge, and planned
 * future character items from raw record fields when exporting a spoiler-safe bundle.
 */
export function redactCharacterFieldsForExport(
  fields: JsonObject,
  policy: WritingContextPolicy,
  scope?: { point?: NarrativePoint | null; edges?: readonly OrderEdge[] },
): JsonObject {
  const copy: JsonObject = { ...fields };
  delete copy[DOSSIER_MARKDOWN_ARCHIVE_KEY];
  if (!(CHARACTER_DEVELOPMENT_KEY in copy)) return copy;
  const read = readCharacterDevelopment(copy);
  const point = scope?.point ?? null;
  const edges = scope?.edges ?? [];
  const filteredKnowledge = filterKnowledgeForWriting(read.profile.knowledge, policy).filter((item) => {
    if (!point || policy.includeSpoilers) return true;
    return knowledgeWindowOpen(item, point, edges);
  });
  const filteredChanges = policy.includePlanned
    ? read.profile.stateChanges
    : read.profile.stateChanges.filter((item) => !item.planned);
  const filteredArcs = policy.includePlanned
    ? read.profile.arcs
    : read.profile.arcs.filter((arc) => arc.approval === "approved");
  const redacted: CharacterDevelopment = {
    ...read.profile,
    livedExperience: emptyLivedExperience(),
    knowledge: filteredKnowledge,
    stateChanges: filteredChanges,
    arcs: filteredArcs,
    reviewNotes: [],
    migrationHold: [],
  };
  return withCharacterDevelopment(copy, redacted);
}
