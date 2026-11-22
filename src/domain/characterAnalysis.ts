import { z } from "zod";
import { resolveQuotation } from "@/analyze/chapterAnalysisReview";
import {
  FOUNDATION_TEXT_KEYS,
  PSYCHOLOGY_TEXT_KEYS,
  REVIEW_CHECKS,
  VOICE_TEXT_KEYS,
  type ReviewCheck,
} from "@/domain/characterDevelopment";
import { newId } from "@/domain/ids";
import type { RetrievalOmission } from "@/assistant/retrievalMeta";

/*
 * Evidence-based Living Character Profile analysis (pure domain).
 * Findings stay separate from canon until the author accepts them.
 */

export const CHARACTER_ANALYSIS_ACTIONS = [
  "enneagram_classifications",
  "archetypes",
  "internal_misbeliefs",
  "motivations",
  "psychological_consistency",
  "character_voice",
  "behavioral_patterns",
  "relationship_development",
  "strengths_contradictions_blind_spots",
  "character_arcs",
  "development_milestones",
] as const;
export type CharacterAnalysisAction = (typeof CHARACTER_ANALYSIS_ACTIONS)[number];

export const CHARACTER_ANALYSIS_SCOPE_KINDS = [
  "scene",
  "chapter",
  "chapter_range",
  "book",
  "multi_book",
  "series",
] as const;
export type CharacterAnalysisScopeKind = (typeof CHARACTER_ANALYSIS_SCOPE_KINDS)[number];

export const PLAN_COMPARISONS = [
  "completed_milestone",
  "missing_development",
  "premature_transformation",
  "inconsistent_behavior",
  "regression",
  "unexplained_change",
  "intentional_contradiction",
  "underdeveloped_relationship",
] as const;
export type PlanComparison = (typeof PLAN_COMPARISONS)[number];

export const DELIBERATE_CHOICE_ASSESSMENTS = [
  "potential_problem",
  "possible_intentional_choice",
  "deliberate_confirmed",
  "unclear",
] as const;
export type DeliberateChoiceAssessment = (typeof DELIBERATE_CHOICE_ASSESSMENTS)[number];

export const FINDING_DECISION_ACTIONS = [
  "pending",
  "accept",
  "edit_accept",
  "dismiss",
  "defer",
  "intentional",
  "further_analysis",
] as const;
export type FindingDecisionAction = (typeof FINDING_DECISION_ACTIONS)[number];

export const CHARACTER_ANALYSIS_RUN_STATUSES = [
  "preparing",
  "running",
  "partial",
  "proposed",
  "applying",
  "applied",
  "failed",
  "cancelled",
] as const;
export type CharacterAnalysisRunStatus = (typeof CHARACTER_ANALYSIS_RUN_STATUSES)[number];

export const SOURCE_REF_KINDS = ["manuscript", "reference", "fact", "dossier"] as const;
export type SourceRefKind = (typeof SOURCE_REF_KINDS)[number];

export const CHARACTER_ANALYSIS_SCHEMA_NAME = "wordly_character_analysis";

export const ACTION_BOUNDARIES: Record<CharacterAnalysisAction, string> = {
  enneagram_classifications:
    "Optional Enneagram type/wing and alternative personality frameworks as writing aids, not diagnoses.",
  archetypes: "Primary, secondary, shadow, or period archetypes. Narrative role is not an archetype.",
  internal_misbeliefs: "Internal misbeliefs the manuscript or plan suggests the character holds.",
  motivations: "Core desire, fear, motivation, conscious wants, and unconscious needs grounded in evidence.",
  psychological_consistency: "Whether observed behavior matches documented psychology and plans.",
  character_voice: "Diction, rhythm, verbal habits, and dialogue consistency in the cited passages.",
  behavioral_patterns: "Habits, mannerisms, and pressure responses shown in the manuscript.",
  relationship_development: "How relationships progress, stall, or regress across the scoped material.",
  strengths_contradictions_blind_spots: "Strengths, contradictions, and blind spots supported by evidence.",
  character_arcs: "Arc progress, stalls, or mismatches against documented arcs.",
  development_milestones: "Suggested or observed development milestones with story location.",
};

export interface CharacterAnalysisScopeSpec {
  sceneRecordId?: string | null;
  chapterRecordId?: string | null;
  chapterFromId?: string | null;
  chapterToId?: string | null;
  bookProjectIds?: string[];
  draftId?: string | null;
  narrativePoint?: {
    bookProjectId: string;
    storyEventId?: string | null;
    chapterRecordId?: string | null;
    sceneRecordId?: string | null;
    sequence?: number | null;
  } | null;
}

export interface AnalysisSourceRef {
  recordId: string;
  recordTitle: string;
  projectId: string;
  revisionNumber: number;
  kind: SourceRefKind;
  passageStart: number | null;
  passageEnd: number | null;
  excerpt: string;
  occurrence: number;
  verified: boolean;
  blockedReason?: string;
}

export interface AnalysisStoryLocation {
  bookProjectId: string;
  bookLabel: string;
  chapterRecordId: string | null;
  chapterTitle: string | null;
  sceneRecordId: string | null;
  sceneTitle: string | null;
  storyEventId: string | null;
  storyPositionLabel: string;
}

export interface AnalysisSuggestedAction {
  kind: "profile_field" | "review_note" | "none";
  targetPath: string;
  value: string;
  reviewCheck: ReviewCheck | "";
}

export interface CharacterAnalysisFinding {
  id: string;
  action: CharacterAnalysisAction;
  observation: string;
  supportingEvidence: string[];
  sourceRefs: AnalysisSourceRef[];
  characterRecordId: string;
  characterName: string;
  storyLocation: AnalysisStoryLocation;
  reasoning: string;
  uncertain: boolean;
  uncertaintyNote: string;
  suggestedAction: AnalysisSuggestedAction;
  planComparison: PlanComparison | null;
  deliberateChoiceAssessment: DeliberateChoiceAssessment;
  sourceVerified: boolean;
  blockedReason?: string;
  segmentIndex: number;
}

export interface FindingDecisionEvent {
  action: FindingDecisionAction;
  note: string;
  editedValue: string;
  at: string;
}

export interface FindingDecision {
  action: FindingDecisionAction;
  editedValue: string;
  editedNote: string;
  reason: string;
  updatedAt: string;
  appliedPackageId: string | null;
  history: FindingDecisionEvent[];
}

export type FindingDecisions = Record<string, FindingDecision>;

export interface AnalysisSegment {
  index: number;
  label: string;
  recordIds: string[];
  /** Inclusive char offsets into each record body when a chapter is split. */
  passages: Array<{ recordId: string; start: number; end: number }>;
  estimatedChars: number;
  status: "pending" | "complete" | "failed" | "cancelled";
}

export interface SegmentResult {
  index: number;
  status: "complete" | "failed" | "cancelled";
  findings: CharacterAnalysisFinding[];
  errorCode?: string;
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface CharacterAnalysisProposal {
  findings: CharacterAnalysisFinding[];
  omissions: RetrievalOmission[];
  totalSegments: number;
  completedSegments: number;
}

export const CHARACTER_ANALYSIS_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "action",
          "observation",
          "supportingEvidence",
          "sourceRefs",
          "characterRecordId",
          "characterName",
          "storyLocation",
          "reasoning",
          "uncertain",
          "uncertaintyNote",
          "suggestedAction",
          "planComparison",
          "deliberateChoiceAssessment",
        ],
        properties: {
          action: { type: "string", enum: [...CHARACTER_ANALYSIS_ACTIONS] },
          observation: { type: "string" },
          supportingEvidence: { type: "array", items: { type: "string" } },
          sourceRefs: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["recordId", "excerpt", "occurrence", "kind"],
              properties: {
                recordId: { type: "string" },
                excerpt: { type: "string" },
                occurrence: { type: "integer", minimum: 1 },
                kind: { type: "string", enum: [...SOURCE_REF_KINDS] },
              },
            },
          },
          characterRecordId: { type: "string" },
          characterName: { type: "string" },
          storyLocation: {
            type: "object",
            additionalProperties: false,
            required: [
              "bookProjectId",
              "bookLabel",
              "chapterRecordId",
              "chapterTitle",
              "sceneRecordId",
              "sceneTitle",
              "storyEventId",
              "storyPositionLabel",
            ],
            properties: {
              bookProjectId: { type: "string" },
              bookLabel: { type: "string" },
              chapterRecordId: { type: "string" },
              chapterTitle: { type: "string" },
              sceneRecordId: { type: "string" },
              sceneTitle: { type: "string" },
              storyEventId: { type: "string" },
              storyPositionLabel: { type: "string" },
            },
          },
          reasoning: { type: "string" },
          uncertain: { type: "boolean" },
          uncertaintyNote: { type: "string" },
          suggestedAction: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "targetPath", "value", "reviewCheck"],
            properties: {
              kind: { type: "string", enum: ["profile_field", "review_note", "none"] },
              targetPath: { type: "string" },
              value: { type: "string" },
              reviewCheck: { type: "string" },
            },
          },
          planComparison: {
            anyOf: [{ type: "string", enum: [...PLAN_COMPARISONS] }, { type: "null" }],
          },
          deliberateChoiceAssessment: { type: "string", enum: [...DELIBERATE_CHOICE_ASSESSMENTS] },
        },
      },
    },
  },
} as const;

export const CHARACTER_ANALYSIS_SCHEMA_CHARS = JSON.stringify(CHARACTER_ANALYSIS_OUTPUT_JSON_SCHEMA).length;

const draftSourceRef = z
  .object({
    recordId: z.string(),
    excerpt: z.string(),
    occurrence: z.number().int().min(1),
    kind: z.enum(SOURCE_REF_KINDS),
  })
  .strict();

const draftFinding = z
  .object({
    action: z.enum(CHARACTER_ANALYSIS_ACTIONS),
    observation: z.string(),
    supportingEvidence: z.array(z.string()),
    sourceRefs: z.array(draftSourceRef),
    characterRecordId: z.string(),
    characterName: z.string(),
    storyLocation: z
      .object({
        bookProjectId: z.string(),
        bookLabel: z.string(),
        chapterRecordId: z.string(),
        chapterTitle: z.string(),
        sceneRecordId: z.string(),
        sceneTitle: z.string(),
        storyEventId: z.string(),
        storyPositionLabel: z.string(),
      })
      .strict(),
    reasoning: z.string(),
    uncertain: z.boolean(),
    uncertaintyNote: z.string(),
    suggestedAction: z
      .object({
        kind: z.enum(["profile_field", "review_note", "none"]),
        targetPath: z.string(),
        value: z.string(),
        reviewCheck: z.string(),
      })
      .strict(),
    planComparison: z.enum(PLAN_COMPARISONS).nullable(),
    deliberateChoiceAssessment: z.enum(DELIBERATE_CHOICE_ASSESSMENTS),
  })
  .strict();

const draftSchema = z.object({ findings: z.array(draftFinding) }).strict();

export type CharacterAnalysisDraftFinding = z.infer<typeof draftFinding>;

export function parseCharacterAnalysisOutput(
  text: string,
): { ok: true; findings: CharacterAnalysisDraftFinding[] } | { ok: false; problems: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["Response was not valid JSON."] };
  }
  const result = draftSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, problems: result.error.issues.slice(0, 8).map((issue) => issue.message) };
  }
  return { ok: true, findings: result.data.findings };
}

export interface SourceCatalogEntry {
  recordId: string;
  recordTitle: string;
  projectId: string;
  revisionNumber: number;
  kind: SourceRefKind;
  body: string;
}

export function verifyAndEnrichFindings(
  drafts: readonly CharacterAnalysisDraftFinding[],
  catalog: ReadonlyMap<string, SourceCatalogEntry>,
  characterIds: ReadonlySet<string>,
  segmentIndex: number,
  idFor: () => string = () => newId("carc").replace(/^carc_/, "caf_"),
): CharacterAnalysisFinding[] {
  return drafts.map((draft) => {
    const sourceRefs: AnalysisSourceRef[] = draft.sourceRefs.map((ref) => {
      const entry = catalog.get(ref.recordId);
      if (!entry) {
        return {
          recordId: ref.recordId,
          recordTitle: "",
          projectId: "",
          revisionNumber: 0,
          kind: ref.kind,
          passageStart: null,
          passageEnd: null,
          excerpt: ref.excerpt.trim(),
          occurrence: ref.occurrence,
          verified: false,
          blockedReason: "This source is not in the analysis context.",
        };
      }
      const excerpt = ref.excerpt.trim();
      if (!excerpt) {
        return {
          recordId: entry.recordId,
          recordTitle: entry.recordTitle,
          projectId: entry.projectId,
          revisionNumber: entry.revisionNumber,
          kind: entry.kind,
          passageStart: null,
          passageEnd: null,
          excerpt: "",
          occurrence: ref.occurrence,
          verified: false,
          blockedReason: "The quotation is empty.",
        };
      }
      const resolved = resolveQuotation(entry.body, excerpt, ref.occurrence);
      if (!resolved.ok) {
        return {
          recordId: entry.recordId,
          recordTitle: entry.recordTitle,
          projectId: entry.projectId,
          revisionNumber: entry.revisionNumber,
          kind: entry.kind,
          passageStart: null,
          passageEnd: null,
          excerpt,
          occurrence: ref.occurrence,
          verified: false,
          blockedReason: resolved.reason,
        };
      }
      return {
        recordId: entry.recordId,
        recordTitle: entry.recordTitle,
        projectId: entry.projectId,
        revisionNumber: entry.revisionNumber,
        kind: entry.kind,
        passageStart: resolved.start,
        passageEnd: resolved.end,
        excerpt: resolved.excerpt,
        occurrence: ref.occurrence,
        verified: true,
      };
    });

    const characterOk = characterIds.has(draft.characterRecordId);
    const unverified = sourceRefs.filter((ref) => !ref.verified);
    const needsEvidence = draft.supportingEvidence.some((item) => item.trim()) || sourceRefs.length > 0;
    let blockedReason: string | undefined;
    if (!characterOk) blockedReason = "The finding names a character that was not in this analysis.";
    else if (needsEvidence && sourceRefs.length === 0) blockedReason = "The finding has no source references.";
    else if (unverified.length) blockedReason = unverified[0]?.blockedReason ?? "A quotation could not be verified.";

    const reviewCheck = (REVIEW_CHECKS as readonly string[]).includes(draft.suggestedAction.reviewCheck)
      ? (draft.suggestedAction.reviewCheck as ReviewCheck)
      : "";

    const suggestedAction: AnalysisSuggestedAction = {
      kind: draft.suggestedAction.kind,
      targetPath: draft.suggestedAction.targetPath.trim(),
      value: draft.suggestedAction.value.trim(),
      reviewCheck,
    };
    if (suggestedAction.kind === "profile_field" && !isAllowedProfilePath(suggestedAction.targetPath)) {
      suggestedAction.kind = "none";
      suggestedAction.targetPath = "";
    }

    return {
      id: idFor(),
      action: draft.action,
      observation: draft.observation.trim(),
      supportingEvidence: draft.supportingEvidence.map((item) => item.trim()).filter(Boolean),
      sourceRefs,
      characterRecordId: draft.characterRecordId,
      characterName: draft.characterName.trim(),
      storyLocation: {
        bookProjectId: draft.storyLocation.bookProjectId,
        bookLabel: draft.storyLocation.bookLabel,
        chapterRecordId: draft.storyLocation.chapterRecordId || null,
        chapterTitle: draft.storyLocation.chapterTitle || null,
        sceneRecordId: draft.storyLocation.sceneRecordId || null,
        sceneTitle: draft.storyLocation.sceneTitle || null,
        storyEventId: draft.storyLocation.storyEventId || null,
        storyPositionLabel: draft.storyLocation.storyPositionLabel,
      },
      reasoning: draft.reasoning.trim(),
      uncertain: draft.uncertain,
      uncertaintyNote: draft.uncertaintyNote.trim(),
      suggestedAction,
      planComparison: draft.planComparison,
      deliberateChoiceAssessment: draft.deliberateChoiceAssessment,
      sourceVerified: !blockedReason,
      blockedReason,
      segmentIndex,
    };
  });
}

function isAllowedProfilePath(path: string): boolean {
  if (!path) return false;
  if (path === "psychology.enneagram" || path === "psychology.wing") return true;
  if (path.startsWith("psychology.")) {
    const key = path.slice("psychology.".length);
    return (PSYCHOLOGY_TEXT_KEYS as readonly string[]).includes(key);
  }
  if (path.startsWith("foundation.")) {
    const key = path.slice("foundation.".length);
    return (FOUNDATION_TEXT_KEYS as readonly string[]).includes(key);
  }
  if (path.startsWith("voice.")) {
    const key = path.slice("voice.".length);
    return (VOICE_TEXT_KEYS as readonly string[]).includes(key);
  }
  if (path === "archetypes" || path === "arcs" || path.startsWith("behavior.")) return true;
  return false;
}

function normalizeKey(text: string): string {
  return text.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

/** Merge duplicate findings across segments. Keeps earliest story location and unions evidence. */
export function aggregateCharacterFindings(findings: readonly CharacterAnalysisFinding[]): CharacterAnalysisFinding[] {
  const groups = new Map<string, CharacterAnalysisFinding>();
  for (const finding of findings) {
    const key = [
      finding.characterRecordId,
      finding.action,
      finding.planComparison ?? "",
      normalizeKey(finding.observation),
    ].join("\0");
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...finding, sourceRefs: [...finding.sourceRefs], supportingEvidence: [...finding.supportingEvidence] });
      continue;
    }
    const evidence = new Set(existing.supportingEvidence);
    for (const item of finding.supportingEvidence) evidence.add(item);
    const refs = [...existing.sourceRefs];
    for (const ref of finding.sourceRefs) {
      if (!refs.some((row) => row.recordId === ref.recordId && row.excerpt === ref.excerpt && row.occurrence === ref.occurrence)) {
        refs.push(ref);
      }
    }
    const blocked = existing.blockedReason && finding.blockedReason ? existing.blockedReason : existing.blockedReason || finding.blockedReason;
    groups.set(key, {
      ...existing,
      supportingEvidence: [...evidence],
      sourceRefs: refs,
      reasoning: existing.reasoning.length >= finding.reasoning.length ? existing.reasoning : finding.reasoning,
      uncertain: existing.uncertain || finding.uncertain,
      uncertaintyNote: [existing.uncertaintyNote, finding.uncertaintyNote].filter(Boolean).join(" "),
      sourceVerified: existing.sourceVerified && finding.sourceVerified,
      blockedReason: blocked,
      deliberateChoiceAssessment:
        existing.deliberateChoiceAssessment === "deliberate_confirmed" || finding.deliberateChoiceAssessment === "deliberate_confirmed"
          ? "deliberate_confirmed"
          : existing.deliberateChoiceAssessment === "potential_problem" || finding.deliberateChoiceAssessment === "potential_problem"
            ? "potential_problem"
            : existing.deliberateChoiceAssessment,
    });
  }
  return [...groups.values()];
}

export function emptyDecision(): FindingDecision {
  return {
    action: "pending",
    editedValue: "",
    editedNote: "",
    reason: "",
    updatedAt: new Date().toISOString(),
    appliedPackageId: null,
    history: [],
  };
}

export function applyFindingDecision(
  current: FindingDecision | undefined,
  patch: Partial<Pick<FindingDecision, "action" | "editedValue" | "editedNote" | "reason" | "appliedPackageId">>,
  now = new Date(),
): FindingDecision {
  const base = current ?? emptyDecision();
  const next: FindingDecision = {
    ...base,
    ...patch,
    updatedAt: now.toISOString(),
    history: [...base.history],
  };
  if (patch.action && patch.action !== base.action) {
    next.history = [
      ...base.history,
      {
        action: patch.action,
        note: patch.reason ?? patch.editedNote ?? "",
        editedValue: patch.editedValue ?? "",
        at: now.toISOString(),
      },
    ];
  }
  return next;
}

export function characterAnalysisInstructions(actions: readonly CharacterAnalysisAction[]): string {
  const lines = [
    "You analyze living character profiles against manuscript evidence for Story Loom.",
    "You propose observations only. You do not rewrite the manuscript or approve canon.",
    "Hard rules:",
    "- Every sourceRefs.excerpt must be copied character-for-character from the provided SOURCE text. Do not paraphrase quotations.",
    "- occurrence is which copy of the quotation you mean, starting at 1.",
    "- Cite only record ids that appear in the catalogs. Do not invent sources.",
    "- Approved arcs and approved state changes are canon. Drafts, plans, and AI notes are not.",
    "- Personality frameworks and Enneagram are writing aids, not diagnoses or behavioural rules.",
    "- Do not invent trauma, disability, neurodivergence, mental-health conditions, or secrets.",
    "- Distinguish deliberate author choices from potential problems using deliberateChoiceAssessment.",
    "- When comparing plans to manuscript behavior, set planComparison; otherwise null.",
    "- If evidence is thin, set uncertain true and explain in uncertaintyNote.",
    "- Prefer matching characterRecordId to the CHARACTER catalog ids.",
    "- Propose only the analysis actions named below.",
    "",
    "ACTIONS:",
    ...actions.map((action) => `- ${action}: ${ACTION_BOUNDARIES[action]}`),
  ];
  return lines.join("\n");
}

/** Partition manuscript units into segments that fit the remaining char budget. */
export function segmentManuscriptUnits(
  units: readonly {
    recordId: string;
    label: string;
    body: string;
    projectId: string;
  }[],
  maxSegmentChars: number,
): AnalysisSegment[] {
  const segments: AnalysisSegment[] = [];
  let current: AnalysisSegment | null = null;
  let budget = 0;

  const pushCurrent = () => {
    if (current) segments.push(current);
    current = null;
    budget = 0;
  };

  for (const unit of units) {
    const body = unit.body;
    if (body.length === 0) continue;
    if (body.length > maxSegmentChars) {
      pushCurrent();
      let start = 0;
      let part = 0;
      while (start < body.length) {
        let end = Math.min(start + maxSegmentChars, body.length);
        if (end < body.length) {
          const breakAt = body.lastIndexOf("\n\n", end);
          if (breakAt > start + Math.floor(maxSegmentChars * 0.4)) end = breakAt + 2;
        }
        segments.push({
          index: segments.length,
          label: `${unit.label} (part ${part + 1})`,
          recordIds: [unit.recordId],
          passages: [{ recordId: unit.recordId, start, end }],
          estimatedChars: end - start,
          status: "pending",
        });
        start = end;
        part += 1;
      }
      continue;
    }
    if (!current || budget + body.length > maxSegmentChars) {
      pushCurrent();
      current = {
        index: segments.length,
        label: unit.label,
        recordIds: [unit.recordId],
        passages: [{ recordId: unit.recordId, start: 0, end: body.length }],
        estimatedChars: body.length,
        status: "pending",
      };
      budget = body.length;
    } else {
      current.recordIds.push(unit.recordId);
      current.passages.push({ recordId: unit.recordId, start: 0, end: body.length });
      current.label = `${current.label}; ${unit.label}`;
      current.estimatedChars += body.length;
      budget += body.length;
    }
  }
  pushCurrent();
  return segments.map((segment, index) => ({ ...segment, index }));
}

export function parseJsonArray<T>(raw: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export function parseJsonObject<T extends object>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

export interface CharacterAnalysisUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated: boolean;
}

export interface CharacterAnalysisRunView {
  id: string;
  projectId: string;
  characterRecordIds: string[];
  scopeKind: CharacterAnalysisScopeKind;
  scopeSpec: CharacterAnalysisScopeSpec;
  actions: CharacterAnalysisAction[];
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  totalSegments: number;
  completedSegments: number;
  currentSegmentLabel: string;
  segments: AnalysisSegment[];
  findings: CharacterAnalysisFinding[];
  decisions: FindingDecisions;
  omissions: RetrievalOmission[];
  appliedPackageIds: string[];
  sourceHash: string;
  contentHash: string;
  model: string | null;
  usage: CharacterAnalysisUsage | null;
  requestChars: number;
  createdAt: string;
  completedAt: string | null;
}
