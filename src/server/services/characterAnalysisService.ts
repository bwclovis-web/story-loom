import { estimateTokens, analysisOutputTokens } from "@/assistant/config";
import { checkSize, describeSizeProblem, type ProviderMessage } from "@/assistant/prompt";
import { ProviderError, type AssistantProvider, type OutputSchema } from "@/assistant/provider";
import type { RetrievalOmission } from "@/assistant/retrievalMeta";
import {
  CHANGE_PACKAGE_FORMAT,
  CHANGE_PACKAGE_FORMAT_VERSION,
  type ChangePackageV1,
} from "@/changePackage/schema.v1";
import {
  ACTION_BOUNDARIES,
  CHARACTER_ANALYSIS_ACTIONS,
  CHARACTER_ANALYSIS_OUTPUT_JSON_SCHEMA,
  CHARACTER_ANALYSIS_SCHEMA_CHARS,
  CHARACTER_ANALYSIS_SCHEMA_NAME,
  CHARACTER_ANALYSIS_SCOPE_KINDS,
  aggregateCharacterFindings,
  applyFindingDecision,
  characterAnalysisInstructions,
  emptyDecision,
  parseCharacterAnalysisOutput,
  parseJsonArray,
  parseJsonObject,
  segmentManuscriptUnits,
  verifyAndEnrichFindings,
  type AnalysisSegment,
  type CharacterAnalysisAction,
  type CharacterAnalysisFinding,
  type CharacterAnalysisRunView,
  type CharacterAnalysisScopeKind,
  type CharacterAnalysisScopeSpec,
  type FindingDecisionAction,
  type FindingDecisions,
  type SegmentResult,
  type SourceCatalogEntry,
} from "@/domain/characterAnalysis";

export type { CharacterAnalysisRunView };
import {
  CHARACTER_DEVELOPMENT_KEY,
  applyProfileSuggestions,
  renderCharacterContextSlice,
  reviewNotesFromObservations,
  type CharacterDevelopment,
  type ProfileSuggestion,
  type ReviewObservation,
  withCharacterDevelopment,
} from "@/domain/characterDevelopment";
import { newId } from "@/domain/ids";
import { sha256, type JsonObject } from "@/domain/json";
import type { Db, DbOrTx } from "../db";
import {
  AssistantError,
  checkRequestLimits,
  estimatedUsage,
  usageSummary,
  type AssistantRuntime,
  type UsageSummary,
} from "./assistantService";
import { applyChangePackage, type ApplyOutcome } from "./changePackageService";
import { loadCharacterDevelopment } from "./characterDevelopmentService";
import { NotFoundError } from "./errors";
import { listSeriesBookProjects } from "./projectService";
import { LIVE_RECORD } from "./trashFilters";

/*
 * Evidence-based living character analysis. Reuses assistant providers, limits,
 * cancellation, and change-package apply. Findings stay on CharacterAnalysisRun
 * until the author accepts them.
 */

const FIXED_OVERHEAD_RESERVE = 12_000;

export type CharacterAnalysisProgressEvent =
  | { type: "started"; runId: string; totalSegments: number; requestChars: number }
  | { type: "segment_started"; runId: string; segmentIndex: number; label: string }
  | { type: "segment_done"; runId: string; segmentIndex: number; findingCount: number }
  | { type: "aggregating"; runId: string }
  | { type: "done"; result: CharacterAnalysisRunView }
  | { type: "error"; message: string };

export interface CharacterAnalysisPreview {
  characterTitles: string[];
  scopeKind: CharacterAnalysisScopeKind;
  actions: CharacterAnalysisAction[];
  segmentCount: number;
  segments: Array<{ index: number; label: string; estimatedChars: number }>;
  omissions: RetrievalOmission[];
  inputChars: number;
  estimatedInputTokens: number;
  outputTokenAllowance: number;
  estimatedTotalTokens: number;
  requestsLastHour: number;
  maxRequestsPerHour: number;
  monthTokens: number;
  monthlyTokenCap: number;
  sourceHash: string;
  model: string | null;
  configured: boolean;
  problem: string | null;
}

export interface PrepareCharacterAnalysisInput {
  projectId: string;
  characterRecordIds: string[];
  scopeKind: CharacterAnalysisScopeKind;
  scopeSpec?: CharacterAnalysisScopeSpec;
  actions?: CharacterAnalysisAction[];
  expectedSourceHash?: string;
  resumeRunId?: string;
}

export interface PreparedCharacterAnalysis {
  runId: string;
  requestChars: number;
  sourceHash: string;
  segments: AnalysisSegment[];
  actions: CharacterAnalysisAction[];
  characterRecordIds: string[];
  scopeKind: CharacterAnalysisScopeKind;
  scopeSpec: CharacterAnalysisScopeSpec;
  omissions: RetrievalOmission[];
  sharedContextText: string;
  catalog: Map<string, SourceCatalogEntry>;
  manuscriptBodies: Map<string, { title: string; projectId: string; revision: number; body: string; label: string }>;
  limits: AssistantRuntime["limits"];
  outputTokenAllowance: number;
  model: string;
  resumeFromSegment: number;
}

function parseStringArray(raw: string): string[] {
  return parseJsonArray<string>(raw, []).filter((item) => typeof item === "string");
}

function parseActions(raw: string): CharacterAnalysisAction[] {
  const allowed = new Set<string>(CHARACTER_ANALYSIS_ACTIONS);
  return parseStringArray(raw).filter((item): item is CharacterAnalysisAction => allowed.has(item));
}

function rowToView(row: {
  id: string;
  projectId: string;
  characterRecordIdsJson: string;
  scopeKind: string;
  scopeSpecJson: string;
  actionsJson: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  totalSegments: number;
  completedSegments: number;
  currentSegmentLabel: string;
  segmentsJson: string;
  findingsJson: string;
  decisionsJson: string;
  omissionsJson: string;
  appliedPackageIdsJson: string;
  sourceHash: string;
  contentHash: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  usageEstimated: boolean;
  requestChars: number;
  createdAt: Date;
  completedAt: Date | null;
}): CharacterAnalysisRunView {
  return {
    id: row.id,
    projectId: row.projectId,
    characterRecordIds: parseStringArray(row.characterRecordIdsJson),
    scopeKind: (CHARACTER_ANALYSIS_SCOPE_KINDS as readonly string[]).includes(row.scopeKind)
      ? (row.scopeKind as CharacterAnalysisScopeKind)
      : "book",
    scopeSpec: parseJsonObject<CharacterAnalysisScopeSpec>(row.scopeSpecJson, {}),
    actions: parseActions(row.actionsJson),
    status: row.status,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    totalSegments: row.totalSegments,
    completedSegments: row.completedSegments,
    currentSegmentLabel: row.currentSegmentLabel,
    segments: parseJsonArray<AnalysisSegment>(row.segmentsJson, []),
    findings: parseJsonArray<CharacterAnalysisFinding>(row.findingsJson, []),
    decisions: parseJsonObject<FindingDecisions>(row.decisionsJson, {}),
    omissions: parseJsonArray<RetrievalOmission>(row.omissionsJson, []),
    appliedPackageIds: parseStringArray(row.appliedPackageIdsJson),
    sourceHash: row.sourceHash,
    contentHash: row.contentHash,
    model: row.model,
    usage:
      row.totalTokens != null
        ? {
            inputTokens: row.inputTokens ?? 0,
            outputTokens: row.outputTokens ?? 0,
            totalTokens: row.totalTokens,
            estimated: row.usageEstimated,
          }
        : null,
    requestChars: row.requestChars,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function projectBookIds(db: DbOrTx, projectId: string, scopeKind: CharacterAnalysisScopeKind, scopeSpec: CharacterAnalysisScopeSpec): Promise<string[]> {
  if (scopeKind === "series" || scopeKind === "multi_book") {
    if (scopeKind === "multi_book" && scopeSpec.bookProjectIds?.length) return [...new Set(scopeSpec.bookProjectIds)];
    const siblings = await listSeriesBookProjects(db, projectId);
    return siblings.length ? siblings.map((book) => book.id) : [projectId];
  }
  return [projectId];
}

async function loadManuscriptUnits(
  db: DbOrTx,
  bookIds: string[],
  scopeKind: CharacterAnalysisScopeKind,
  scopeSpec: CharacterAnalysisScopeSpec,
  omissions: RetrievalOmission[],
): Promise<Array<{ recordId: string; label: string; body: string; projectId: string; revision: number; title: string; type: string; parentRecordId: string | null; position: number | null }>> {
  const drafts = scopeSpec.draftId
    ? { draftId: scopeSpec.draftId }
    : {};
  const rows = await db.record.findMany({
    where: {
      projectId: { in: bookIds },
      ...LIVE_RECORD,
      type: { in: ["manuscript_chapter", "manuscript_scene"] },
      ...drafts,
    },
    select: {
      id: true,
      title: true,
      body: true,
      type: true,
      projectId: true,
      currentRevision: true,
      parentRecordId: true,
      position: true,
      createdAt: true,
    },
    orderBy: [{ projectId: "asc" }, { position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  let filtered = rows;
  if (scopeKind === "scene" && scopeSpec.sceneRecordId) {
    filtered = rows.filter((row) => row.id === scopeSpec.sceneRecordId || (row.type === "manuscript_scene" && row.id === scopeSpec.sceneRecordId));
    if (!filtered.length) omissions.push({ label: "Selected scene", reason: "The selected scene was not found in scope.", recordId: scopeSpec.sceneRecordId });
  } else if (scopeKind === "chapter" && scopeSpec.chapterRecordId) {
    const chapterId = scopeSpec.chapterRecordId;
    filtered = rows.filter((row) => row.id === chapterId || row.parentRecordId === chapterId);
    if (!filtered.some((row) => row.id === chapterId)) {
      omissions.push({ label: "Selected chapter", reason: "The selected chapter was not found in scope.", recordId: chapterId });
    }
  } else if (scopeKind === "chapter_range") {
    const chapters = rows.filter((row) => row.type === "manuscript_chapter");
    let fromIdx = 0;
    let toIdx = chapters.length - 1;
    if (scopeSpec.chapterFromId) {
      const i = chapters.findIndex((c) => c.id === scopeSpec.chapterFromId);
      if (i >= 0) fromIdx = i;
      else omissions.push({ label: "Chapter range start", reason: "Start chapter was not found.", recordId: scopeSpec.chapterFromId });
    }
    if (scopeSpec.chapterToId) {
      const i = chapters.findIndex((c) => c.id === scopeSpec.chapterToId);
      if (i >= 0) toIdx = i;
      else omissions.push({ label: "Chapter range end", reason: "End chapter was not found.", recordId: scopeSpec.chapterToId });
    }
    const allowed = new Set(chapters.slice(fromIdx, toIdx + 1).map((c) => c.id));
    filtered = rows.filter((row) => allowed.has(row.id) || (row.parentRecordId && allowed.has(row.parentRecordId)));
  }

  for (const row of filtered) {
    if (!row.body.trim()) {
      omissions.push({ label: row.title, reason: "Manuscript unit is empty.", recordId: row.id });
    }
  }

  return filtered.map((row) => ({
    recordId: row.id,
    label: row.title,
    body: row.body,
    projectId: row.projectId,
    revision: row.currentRevision,
    title: row.title,
    type: row.type,
    parentRecordId: row.parentRecordId,
    position: row.position,
  }));
}

async function assembleContext(
  db: Db,
  runtime: AssistantRuntime,
  input: PrepareCharacterAnalysisInput,
  now = new Date(),
): Promise<{
  project: { id: string; title: string; workspaceId: string };
  actions: CharacterAnalysisAction[];
  scopeKind: CharacterAnalysisScopeKind;
  scopeSpec: CharacterAnalysisScopeSpec;
  characterRecordIds: string[];
  sharedContextText: string;
  catalog: Map<string, SourceCatalogEntry>;
  manuscriptBodies: Map<string, { title: string; projectId: string; revision: number; body: string; label: string }>;
  units: Array<{ recordId: string; label: string; body: string; projectId: string }>;
  segments: AnalysisSegment[];
  omissions: RetrievalOmission[];
  sourceHash: string;
  requestChars: number;
  outputTokenAllowance: number;
  usage: UsageSummary | null;
}> {
  if (!runtime.configured || !runtime.model) {
    throw new AssistantError("NOT_CONFIGURED", "Character analysis uses the assistant, which is not set up. See How to use, \"Assistant setup\".");
  }
  const project = await db.project.findFirst({ where: { id: input.projectId }, select: { id: true, title: true, workspaceId: true } });
  if (!project) throw new NotFoundError("Project not found");

  const scopeKind = input.scopeKind;
  const scopeSpec = input.scopeSpec ?? {};
  const actions =
    input.actions?.length && input.actions.every((action) => (CHARACTER_ANALYSIS_ACTIONS as readonly string[]).includes(action))
      ? [...input.actions]
      : [...CHARACTER_ANALYSIS_ACTIONS];
  const characterRecordIds = [...new Set(input.characterRecordIds)];
  if (!characterRecordIds.length) throw new AssistantError("INVALID_REQUEST", "Choose at least one character.");

  const omissions: RetrievalOmission[] = [];
  const bookIds = await projectBookIds(db, input.projectId, scopeKind, scopeSpec);
  const bookLabel = new Map(
    (await listSeriesBookProjects(db, input.projectId)).map((book) => [book.id, book.bookName?.trim() || book.title]),
  );
  bookLabel.set(project.id, project.title);

  const catalog = new Map<string, SourceCatalogEntry>();
  const profileBlocks: string[] = [];
  for (const characterId of characterRecordIds) {
    try {
      const loaded = await loadCharacterDevelopment(db, input.projectId, characterId);
      const point = scopeSpec.narrativePoint
        ? {
            bookProjectId: scopeSpec.narrativePoint.bookProjectId,
            storyEventId: scopeSpec.narrativePoint.storyEventId ?? null,
            sequence: scopeSpec.narrativePoint.sequence ?? null,
            chapterRecordId: scopeSpec.narrativePoint.chapterRecordId ?? null,
            sceneRecordId: scopeSpec.narrativePoint.sceneRecordId ?? null,
          }
        : { bookProjectId: loaded.record.projectId, storyEventId: null, sequence: null };
      const text = renderCharacterContextSlice({
        title: loaded.record.title,
        body: loaded.record.body,
        profile: loaded.profile,
        slice: "continuity",
        bookProjectId: point.bookProjectId,
        point,
      });
      profileBlocks.push(`<<SOURCE character dossier id=${JSON.stringify(characterId)}>>\n${text}\n<<END-SOURCE>>`);
      catalog.set(characterId, {
        recordId: characterId,
        recordTitle: loaded.record.title,
        projectId: loaded.record.projectId,
        revisionNumber: loaded.record.currentRevision,
        kind: "dossier",
        body: `${loaded.record.body}\n${text}`,
      });
    } catch {
      omissions.push({ label: characterId, reason: "Character dossier was not found.", recordId: characterId });
    }
  }
  if (!catalog.size) throw new AssistantError("INVALID_REQUEST", "None of the selected characters could be loaded.");

  const refs = await db.record.findMany({
    where: {
      projectId: { in: bookIds },
      ...LIVE_RECORD,
      type: { in: ["worldbuilding", "rules_glossary", "reference_note"] },
      authorityStatus: "approved",
    },
    select: { id: true, title: true, body: true, projectId: true, currentRevision: true, authorityStatus: true },
    take: 80,
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
  const unapproved = await db.record.count({
    where: {
      projectId: { in: bookIds },
      ...LIVE_RECORD,
      type: { in: ["worldbuilding", "rules_glossary", "reference_note"] },
      authorityStatus: { not: "approved" },
    },
  });
  if (unapproved) {
    omissions.push({ label: "Unapproved references", reason: `${unapproved} reference records were omitted because they are not approved.` });
  }
  const refBlocks: string[] = [];
  for (const ref of refs) {
    catalog.set(ref.id, {
      recordId: ref.id,
      recordTitle: ref.title,
      projectId: ref.projectId,
      revisionNumber: ref.currentRevision,
      kind: "reference",
      body: ref.body,
    });
    refBlocks.push(`<<SOURCE reference id=${JSON.stringify(ref.id)} title=${JSON.stringify(ref.title)} rev=${ref.currentRevision}>>\n${ref.body}\n<<END-SOURCE>>`);
  }

  const facts = await db.establishedFact.findMany({
    where: { projectId: { in: bookIds }, status: "accepted", subjectRecordId: { in: characterRecordIds } },
    select: { id: true, statement: true, projectId: true, subjectRecordId: true },
    take: 100,
  });
  for (const fact of facts) {
    catalog.set(fact.id, {
      recordId: fact.id,
      recordTitle: fact.statement.slice(0, 80),
      projectId: fact.projectId,
      revisionNumber: 1,
      kind: "fact",
      body: fact.statement,
    });
  }
  const factBlock = facts.length
    ? ["ACCEPTED FACTS:", ...facts.map((fact) => `- ${fact.id}: ${fact.statement}`)].join("\n")
    : "ACCEPTED FACTS: (none)";

  const unitsRaw = await loadManuscriptUnits(db, bookIds, scopeKind, scopeSpec, omissions);
  const manuscriptBodies = new Map(
    unitsRaw.map((unit) => [
      unit.recordId,
      {
        title: unit.title,
        projectId: unit.projectId,
        revision: unit.revision,
        body: unit.body,
        label: `${bookLabel.get(unit.projectId) ?? unit.projectId}: ${unit.title}`,
      },
    ]),
  );
  for (const unit of unitsRaw) {
    catalog.set(unit.recordId, {
      recordId: unit.recordId,
      recordTitle: unit.title,
      projectId: unit.projectId,
      revisionNumber: unit.revision,
      kind: "manuscript",
      body: unit.body,
    });
  }

  const instructions = characterAnalysisInstructions(actions);
  const sharedContextText = [
    `Project: ${project.title}`,
    `Scope: ${scopeKind}`,
    "",
    "CHARACTER PROFILES (approved structured fields preferred; drafts labeled in text):",
    ...profileBlocks,
    "",
    factBlock,
    "",
    "APPROVED REFERENCES:",
    ...refBlocks,
    "",
    "ACTIONS:",
    ...actions.map((action) => `- ${action}: ${ACTION_BOUNDARIES[action]}`),
  ].join("\n");

  const overhead = instructions.length + sharedContextText.length + CHARACTER_ANALYSIS_SCHEMA_CHARS + FIXED_OVERHEAD_RESERVE;
  const maxSegmentChars = Math.max(4_000, runtime.limits.maxInputChars - overhead);
  const units = unitsRaw
    .filter((unit) => unit.body.trim())
    .map((unit) => ({
      recordId: unit.recordId,
      label: `${bookLabel.get(unit.projectId) ?? unit.projectId}: ${unit.title}`,
      body: unit.body,
      projectId: unit.projectId,
    }));
  if (!units.length) {
    omissions.push({ label: "Manuscript", reason: "No manuscript text was available in the selected scope." });
  }
  const segments = segmentManuscriptUnits(units, maxSegmentChars);
  const requestChars =
    overhead +
    segments.reduce((sum, segment) => sum + segment.estimatedChars, 0) +
    Math.max(segments.length, 1) * 200;
  const sourceHash = sha256(
    JSON.stringify({
      characters: characterRecordIds,
      scopeKind,
      scopeSpec,
      actions,
      units: units.map((unit) => ({ id: unit.recordId, hash: sha256(unit.body) })),
      refs: refs.map((ref) => ({ id: ref.id, rev: ref.currentRevision })),
    }),
  );
  const outputTokenAllowance = Math.min(runtime.limits.maxOutputTokens, analysisOutputTokens(runtime.limits));
  const usage = await usageSummary(db, runtime.limits, now);
  return {
    project,
    actions,
    scopeKind,
    scopeSpec,
    characterRecordIds,
    sharedContextText,
    catalog,
    manuscriptBodies,
    units,
    segments,
    omissions,
    sourceHash,
    requestChars,
    outputTokenAllowance,
    usage,
  };
}

function limitProblem(
  limits: AssistantRuntime["limits"],
  requestChars: number,
  usage: UsageSummary | null,
  outputTokenAllowance: number,
  segmentCount: number,
): string | null {
  if (requestChars > limits.maxInputChars * Math.max(segmentCount, 1)) {
    // Broad reviews are segmented; refuse only when a single segment cannot fit.
  }
  if (!usage) return null;
  if (usage.requestsLastHour >= limits.maxRequestsPerHour) {
    return `This app allows ${limits.maxRequestsPerHour} assistant requests per hour, and that many were started in the last hour. Nothing will be sent.`;
  }
  const projected = estimateTokens(requestChars) + outputTokenAllowance * Math.max(segmentCount, 1);
  if (usage.monthTokens + projected > limits.monthlyTokenCap) {
    return `This request could use up to about ${projected.toLocaleString("en-US")} tokens (estimate across segments). The monthly cap is ${limits.monthlyTokenCap.toLocaleString("en-US")}. Nothing will be sent.`;
  }
  return null;
}

export async function previewCharacterAnalysis(
  db: Db,
  runtime: AssistantRuntime,
  input: PrepareCharacterAnalysisInput,
  now = new Date(),
): Promise<CharacterAnalysisPreview> {
  const built = await assembleContext(db, runtime, input, now);
  for (const segment of built.segments) {
    const size = checkSize(
      {
        totalChars: characterAnalysisInstructions(built.actions).length + built.sharedContextText.length + segment.estimatedChars + CHARACTER_ANALYSIS_SCHEMA_CHARS,
        items: [{ label: segment.label, chars: segment.estimatedChars }],
      },
      runtime.limits.maxInputChars,
    );
    if (size) {
      return {
        characterTitles: [...built.catalog.values()].filter((entry) => entry.kind === "dossier").map((entry) => entry.recordTitle),
        scopeKind: built.scopeKind,
        actions: built.actions,
        segmentCount: built.segments.length,
        segments: built.segments.map((item) => ({ index: item.index, label: item.label, estimatedChars: item.estimatedChars })),
        omissions: built.omissions,
        inputChars: built.requestChars,
        estimatedInputTokens: estimateTokens(built.requestChars),
        outputTokenAllowance: built.outputTokenAllowance,
        estimatedTotalTokens: estimateTokens(built.requestChars) + built.outputTokenAllowance * Math.max(built.segments.length, 1),
        requestsLastHour: built.usage?.requestsLastHour ?? 0,
        maxRequestsPerHour: runtime.limits.maxRequestsPerHour,
        monthTokens: built.usage?.monthTokens ?? 0,
        monthlyTokenCap: runtime.limits.monthlyTokenCap,
        sourceHash: built.sourceHash,
        model: runtime.model,
        configured: Boolean(runtime.configured && runtime.model),
        problem: describeSizeProblem(size),
      };
    }
  }
  const problem =
    !runtime.configured || !runtime.model
      ? "The assistant is not set up, so nothing can be sent."
      : built.segments.length === 0
        ? "No manuscript text is available in this scope."
        : limitProblem(runtime.limits, built.requestChars, built.usage, built.outputTokenAllowance, built.segments.length);
  return {
    characterTitles: [...built.catalog.values()].filter((entry) => entry.kind === "dossier").map((entry) => entry.recordTitle),
    scopeKind: built.scopeKind,
    actions: built.actions,
    segmentCount: built.segments.length,
    segments: built.segments.map((item) => ({ index: item.index, label: item.label, estimatedChars: item.estimatedChars })),
    omissions: built.omissions,
    inputChars: built.requestChars,
    estimatedInputTokens: estimateTokens(built.requestChars),
    outputTokenAllowance: built.outputTokenAllowance,
    estimatedTotalTokens: estimateTokens(built.requestChars) + built.outputTokenAllowance * Math.max(built.segments.length, 1),
    requestsLastHour: built.usage?.requestsLastHour ?? 0,
    maxRequestsPerHour: runtime.limits.maxRequestsPerHour,
    monthTokens: built.usage?.monthTokens ?? 0,
    monthlyTokenCap: runtime.limits.monthlyTokenCap,
    sourceHash: built.sourceHash,
    model: runtime.model,
    configured: Boolean(runtime.configured && runtime.model),
    problem,
  };
}

export async function prepareCharacterAnalysis(
  db: Db,
  runtime: AssistantRuntime,
  input: PrepareCharacterAnalysisInput,
  now = new Date(),
): Promise<PreparedCharacterAnalysis> {
  if (!runtime.configured || !runtime.model) {
    throw new AssistantError("NOT_CONFIGURED", "Character analysis uses the assistant, which is not set up.");
  }
  const built = await assembleContext(db, runtime, input, now);
  if (input.expectedSourceHash && input.expectedSourceHash !== built.sourceHash) {
    throw new AssistantError("STALE_SELECTION", "The selection changed after you inspected the request. Preview again.");
  }
  if (!built.segments.length) {
    throw new AssistantError("INVALID_REQUEST", "No manuscript text is available in this scope.");
  }
  const problem = limitProblem(runtime.limits, built.requestChars, built.usage, built.outputTokenAllowance, built.segments.length);
  if (problem) {
    const code = problem.includes("hour") ? "RATE_LIMITED" : "USAGE_CAP";
    throw new AssistantError(code, problem);
  }
  await checkRequestLimits(db, runtime.limits, built.requestChars, now, built.outputTokenAllowance);

  if (input.resumeRunId) {
    const existing = await db.characterAnalysisRun.findFirst({ where: { id: input.resumeRunId, projectId: input.projectId } });
    if (!existing) throw new NotFoundError("Character analysis run not found");
    if (!["partial", "failed", "cancelled"].includes(existing.status)) {
      throw new AssistantError("BUSY", "This analysis cannot be resumed from its current status.");
    }
    const segments = parseJsonArray<AnalysisSegment>(existing.segmentsJson, []);
    const resumeFromSegment = segments.findIndex((segment) => segment.status === "pending" || segment.status === "failed" || segment.status === "cancelled");
    if (resumeFromSegment < 0) throw new AssistantError("INVALID_REQUEST", "Every segment of this run is already complete.");
    await db.characterAnalysisRun.update({
      where: { id: existing.id },
      data: { status: "running", errorCode: null, errorMessage: null, completedAt: null },
    });
    return {
      runId: existing.id,
      requestChars: existing.requestChars || built.requestChars,
      sourceHash: existing.sourceHash || built.sourceHash,
      segments,
      actions: parseActions(existing.actionsJson),
      characterRecordIds: parseStringArray(existing.characterRecordIdsJson),
      scopeKind: existing.scopeKind as CharacterAnalysisScopeKind,
      scopeSpec: parseJsonObject(existing.scopeSpecJson, {}),
      omissions: parseJsonArray(existing.omissionsJson, []),
      sharedContextText: built.sharedContextText,
      catalog: built.catalog,
      manuscriptBodies: built.manuscriptBodies,
      limits: runtime.limits,
      outputTokenAllowance: built.outputTokenAllowance,
      model: runtime.model,
      resumeFromSegment,
    };
  }

  const runId = newId("carc");
  await db.characterAnalysisRun.create({
    data: {
      id: runId,
      workspaceId: built.project.workspaceId,
      projectId: built.project.id,
      characterRecordIdsJson: JSON.stringify(built.characterRecordIds),
      scopeKind: built.scopeKind,
      scopeSpecJson: JSON.stringify(built.scopeSpec),
      actionsJson: JSON.stringify(built.actions),
      status: "preparing",
      totalSegments: built.segments.length,
      completedSegments: 0,
      currentSegmentLabel: "",
      segmentsJson: JSON.stringify(built.segments),
      segmentResultsJson: "[]",
      findingsJson: "[]",
      decisionsJson: "{}",
      omissionsJson: JSON.stringify(built.omissions),
      appliedPackageIdsJson: "[]",
      sourceHash: built.sourceHash,
      requestChars: built.requestChars,
      model: runtime.model,
    },
  });
  return {
    runId,
    requestChars: built.requestChars,
    sourceHash: built.sourceHash,
    segments: built.segments,
    actions: built.actions,
    characterRecordIds: built.characterRecordIds,
    scopeKind: built.scopeKind,
    scopeSpec: built.scopeSpec,
    omissions: built.omissions,
    sharedContextText: built.sharedContextText,
    catalog: built.catalog,
    manuscriptBodies: built.manuscriptBodies,
    limits: runtime.limits,
    outputTokenAllowance: built.outputTokenAllowance,
    model: runtime.model,
    resumeFromSegment: 0,
  };
}

function buildSegmentRequest(
  prep: PreparedCharacterAnalysis,
  segment: AnalysisSegment,
): { instructions: string; input: ProviderMessage[]; userText: string; totalChars: number } {
  const manuscriptParts: string[] = [];
  for (const passage of segment.passages) {
    const body = prep.manuscriptBodies.get(passage.recordId);
    if (!body) continue;
    const text = body.body.slice(passage.start, passage.end);
    manuscriptParts.push(
      `<<SOURCE manuscript id=${JSON.stringify(passage.recordId)} title=${JSON.stringify(body.title)} rev=${body.revision} offset=${passage.start}>>\n${text}\n<<END-SOURCE>>`,
    );
  }
  const instructions = characterAnalysisInstructions(prep.actions);
  const userText = [
    prep.sharedContextText,
    "",
    `SEGMENT ${segment.index + 1} of ${prep.segments.length}: ${segment.label}`,
    "",
    "MANUSCRIPT FOR THIS SEGMENT:",
    ...manuscriptParts,
  ].join("\n");
  return {
    instructions,
    input: [{ role: "user", content: userText }],
    userText,
    totalChars: instructions.length + userText.length + CHARACTER_ANALYSIS_SCHEMA_CHARS,
  };
}

export async function runCharacterAnalysis(
  db: Db,
  provider: AssistantProvider,
  prep: PreparedCharacterAnalysis,
  signal: AbortSignal,
  onProgress?: (event: CharacterAnalysisProgressEvent) => void,
): Promise<CharacterAnalysisRunView> {
  await db.characterAnalysisRun.update({ where: { id: prep.runId }, data: { status: "running" } });
  onProgress?.({ type: "started", runId: prep.runId, totalSegments: prep.segments.length, requestChars: prep.requestChars });

  const characterIds = new Set(prep.characterRecordIds);
  const segmentResults = parseJsonArray<SegmentResult>(
    (await db.characterAnalysisRun.findFirstOrThrow({ where: { id: prep.runId } })).segmentResultsJson,
    [],
  );
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let usageEstimated = false;
  let lastResponseId: string | undefined;
  const segments = [...prep.segments];

  try {
    for (let i = prep.resumeFromSegment; i < segments.length; i++) {
      if (signal.aborted) throw new ProviderError("cancelled", "The request was cancelled.");
      const segment = segments[i]!;
      onProgress?.({ type: "segment_started", runId: prep.runId, segmentIndex: i, label: segment.label });
      await db.characterAnalysisRun.update({
        where: { id: prep.runId },
        data: { currentSegmentLabel: segment.label, completedSegments: i },
      });

      const request = buildSegmentRequest(prep, segment);
      const result = await provider.structured(
        {
          model: prep.model,
          instructions: request.instructions,
          input: request.input,
          maxOutputTokens: prep.outputTokenAllowance,
          timeoutMs: prep.limits.requestTimeoutSeconds * 1000,
        },
        {
          name: CHARACTER_ANALYSIS_SCHEMA_NAME,
          schema: CHARACTER_ANALYSIS_OUTPUT_JSON_SCHEMA as unknown as OutputSchema["schema"],
        },
        signal,
      );
      if (signal.aborted) throw new ProviderError("cancelled", "The request was cancelled.");
      lastResponseId = result.responseId;
      const resultText = result.status === "complete" ? result.text : "";
      let usage = result.usage;
      if (!usage) {
        usage = estimatedUsage(request.totalChars, resultText.length);
        usageEstimated = true;
      }
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      totalTokens += usage.totalTokens;

      if (result.status === "refused" || result.status === "incomplete") {
        segment.status = "failed";
        segmentResults[i] = {
          index: i,
          status: "failed",
          findings: [],
          errorCode: result.status,
          errorMessage: result.status === "refused" ? "The model declined this segment." : "The segment stopped before it finished.",
          ...usage,
        };
        await persistProgress(db, prep.runId, segments, segmentResults, i, inputTokens, outputTokens, totalTokens, usageEstimated, lastResponseId, "partial");
        throw new ProviderError("provider_failed", segmentResults[i]!.errorMessage ?? "Segment failed");
      }

      const parsed = parseCharacterAnalysisOutput(resultText);
      if (!parsed.ok) {
        segment.status = "failed";
        segmentResults[i] = {
          index: i,
          status: "failed",
          findings: [],
          errorCode: "malformed_output",
          errorMessage: "The response was not usable analysis.",
          ...usage,
        };
        await persistProgress(db, prep.runId, segments, segmentResults, i, inputTokens, outputTokens, totalTokens, usageEstimated, lastResponseId, "partial");
        throw new ProviderError("provider_failed", "The response was not usable analysis.");
      }

      const findings = verifyAndEnrichFindings(parsed.findings, prep.catalog, characterIds, i);
      segment.status = "complete";
      segmentResults[i] = { index: i, status: "complete", findings, ...usage };
      await persistProgress(db, prep.runId, segments, segmentResults, i + 1, inputTokens, outputTokens, totalTokens, usageEstimated, lastResponseId, "running");
      onProgress?.({ type: "segment_done", runId: prep.runId, segmentIndex: i, findingCount: findings.length });
    }

    onProgress?.({ type: "aggregating", runId: prep.runId });
    const allFindings = segmentResults.flatMap((result) => result?.findings ?? []);
    const findings = aggregateCharacterFindings(allFindings);
    const contentHash = sha256(JSON.stringify(findings));
    await db.characterAnalysisRun.update({
      where: { id: prep.runId },
      data: {
        status: "proposed",
        findingsJson: JSON.stringify(findings),
        contentHash,
        completedSegments: segments.length,
        currentSegmentLabel: "",
        segmentsJson: JSON.stringify(segments),
        segmentResultsJson: JSON.stringify(segmentResults),
        providerResponseId: lastResponseId ?? null,
        inputTokens,
        outputTokens,
        totalTokens,
        usageEstimated,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
  } catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError("provider_failed", "Character analysis failed unexpectedly.");
    const cancelled = failure.code === "cancelled" || signal.aborted;
    const completed = segments.filter((segment) => segment.status === "complete").length;
    await db.characterAnalysisRun.update({
      where: { id: prep.runId },
      data: {
        status: cancelled ? (completed > 0 ? "partial" : "cancelled") : completed > 0 ? "partial" : "failed",
        errorCode: cancelled ? "cancelled" : failure.code,
        errorMessage: cancelled
          ? "Cancelled. Completed segments are kept so you can resume."
          : failure.message,
        completedSegments: completed,
        segmentsJson: JSON.stringify(segments),
        segmentResultsJson: JSON.stringify(segmentResults),
        findingsJson: JSON.stringify(aggregateCharacterFindings(segmentResults.flatMap((result) => result?.findings ?? []))),
        providerResponseId: lastResponseId ?? null,
        inputTokens: inputTokens || null,
        outputTokens: outputTokens || null,
        totalTokens: totalTokens || null,
        usageEstimated,
        completedAt: new Date(),
      },
    });
  }

  const view = await getCharacterAnalysis(db, (await db.characterAnalysisRun.findFirstOrThrow({ where: { id: prep.runId } })).projectId, prep.runId);
  onProgress?.({ type: "done", result: view });
  return view;
}

async function persistProgress(
  db: Db,
  runId: string,
  segments: AnalysisSegment[],
  segmentResults: SegmentResult[],
  completedSegments: number,
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  usageEstimated: boolean,
  responseId: string | undefined,
  status: string,
) {
  await db.characterAnalysisRun.update({
    where: { id: runId },
    data: {
      status,
      completedSegments,
      segmentsJson: JSON.stringify(segments),
      segmentResultsJson: JSON.stringify(segmentResults),
      findingsJson: JSON.stringify(aggregateCharacterFindings(segmentResults.flatMap((result) => result?.findings ?? []))),
      providerResponseId: responseId ?? null,
      inputTokens,
      outputTokens,
      totalTokens,
      usageEstimated,
    },
  });
}

export async function getCharacterAnalysis(db: DbOrTx, projectId: string, runId: string): Promise<CharacterAnalysisRunView> {
  const row = await db.characterAnalysisRun.findFirst({ where: { id: runId, projectId } });
  if (!row) throw new NotFoundError(`Character analysis ${runId} not found`);
  return rowToView(row);
}

export async function listCharacterAnalyses(db: DbOrTx, projectId: string, limit = 20): Promise<Array<{ id: string; status: string; createdAt: string; characterRecordIds: string[] }>> {
  const rows = await db.characterAnalysisRun.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, status: true, createdAt: true, characterRecordIdsJson: true },
  });
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    characterRecordIds: parseStringArray(row.characterRecordIdsJson),
  }));
}

export async function saveCharacterAnalysisDecision(
  db: Db,
  projectId: string,
  runId: string,
  findingId: string,
  patch: { action: FindingDecisionAction; editedValue?: string; editedNote?: string; reason?: string },
): Promise<CharacterAnalysisRunView> {
  const row = await db.characterAnalysisRun.findFirst({ where: { id: runId, projectId } });
  if (!row) throw new NotFoundError("Character analysis run not found");
  const findings = parseJsonArray<CharacterAnalysisFinding>(row.findingsJson, []);
  if (!findings.some((finding) => finding.id === findingId)) {
    throw new AssistantError("INVALID_REQUEST", "That finding is not in this analysis.");
  }
  const decisions = parseJsonObject<FindingDecisions>(row.decisionsJson, {});
  decisions[findingId] = applyFindingDecision(decisions[findingId], {
    action: patch.action,
    editedValue: patch.editedValue ?? "",
    editedNote: patch.editedNote ?? "",
    reason: patch.reason ?? "",
  });
  await db.characterAnalysisRun.update({ where: { id: runId }, data: { decisionsJson: JSON.stringify(decisions) } });
  return getCharacterAnalysis(db, projectId, runId);
}

function findingToProfileSuggestion(finding: CharacterAnalysisFinding, editedValue: string): ProfileSuggestion | null {
  const action = finding.suggestedAction;
  if (action.kind !== "profile_field" || !action.targetPath) return null;
  const value = editedValue.trim() || action.value.trim();
  if (!value) return null;
  if (action.targetPath === "psychology.enneagram") {
    return { id: finding.id, kind: "enneagram", key: "enneagram", value, evidence: finding.supportingEvidence.join(" "), confidence: finding.uncertain ? "low" : "medium" };
  }
  if (action.targetPath === "psychology.wing") {
    return { id: finding.id, kind: "wing", key: "wing", value, evidence: finding.supportingEvidence.join(" "), confidence: finding.uncertain ? "low" : "medium" };
  }
  if (action.targetPath.startsWith("psychology.")) {
    return {
      id: finding.id,
      kind: "psychology",
      key: action.targetPath.slice("psychology.".length),
      value,
      evidence: finding.supportingEvidence.join(" "),
      confidence: finding.uncertain ? "low" : "medium",
    };
  }
  if (action.targetPath.startsWith("foundation.")) {
    return {
      id: finding.id,
      kind: "foundation",
      key: action.targetPath.slice("foundation.".length),
      value,
      evidence: finding.supportingEvidence.join(" "),
      confidence: finding.uncertain ? "low" : "medium",
    };
  }
  if (action.targetPath.startsWith("voice.")) {
    return {
      id: finding.id,
      kind: "voice",
      key: action.targetPath.slice("voice.".length),
      value,
      evidence: finding.supportingEvidence.join(" "),
      confidence: finding.uncertain ? "low" : "medium",
    };
  }
  if (action.targetPath === "archetypes") {
    return { id: finding.id, kind: "archetype", key: "primary", value, evidence: finding.supportingEvidence.join(" "), confidence: finding.uncertain ? "low" : "medium" };
  }
  if (action.targetPath === "arcs") {
    return { id: finding.id, kind: "arc", key: "arc", value, evidence: finding.supportingEvidence.join(" "), confidence: finding.uncertain ? "low" : "medium" };
  }
  return null;
}

function findingToReviewObservation(finding: CharacterAnalysisFinding, editedValue: string): ReviewObservation | null {
  if (finding.suggestedAction.kind !== "review_note" && !finding.planComparison) return null;
  const check = finding.suggestedAction.reviewCheck || "personality";
  return {
    check,
    summary: finding.observation,
    evidence: finding.supportingEvidence.join(" "),
    uncertainty: finding.uncertaintyNote,
    suggestion: editedValue.trim() || finding.suggestedAction.value || finding.reasoning,
  };
}

export async function applyCharacterAnalysisDecisions(
  db: Db,
  projectId: string,
  runId: string,
  contentHash: string,
  options: { confirmProtected?: boolean } = {},
): Promise<{ outcome: ApplyOutcome; run: CharacterAnalysisRunView }> {
  const row = await db.characterAnalysisRun.findFirst({ where: { id: runId, projectId } });
  if (!row) throw new NotFoundError("Character analysis run not found");
  if (row.contentHash && row.contentHash !== contentHash) {
    throw new AssistantError("STALE_SELECTION", "This analysis changed since you loaded it. Reload and review again.");
  }
  const findings = parseJsonArray<CharacterAnalysisFinding>(row.findingsJson, []);
  const decisions = parseJsonObject<FindingDecisions>(row.decisionsJson, {});
  const accepted = findings.filter((finding) => {
    const decision = decisions[finding.id]?.action;
    return (decision === "accept" || decision === "edit_accept") && finding.sourceVerified;
  });
  const intentional = findings.filter((finding) => decisions[finding.id]?.action === "intentional");
  if (!accepted.length && !intentional.length) {
    throw new AssistantError("INVALID_REQUEST", "Accept or mark intentional at least one finding before applying.");
  }

  const byCharacter = new Map<string, CharacterAnalysisFinding[]>();
  for (const finding of [...accepted, ...intentional]) {
    const list = byCharacter.get(finding.characterRecordId) ?? [];
    list.push(finding);
    byCharacter.set(finding.characterRecordId, list);
  }

  const packageIds: string[] = parseStringArray(row.appliedPackageIdsJson);
  let lastOutcome: ApplyOutcome | null = null;

  for (const [characterId, characterFindings] of byCharacter) {
    const loaded = await loadCharacterDevelopment(db, projectId, characterId);
    if (loaded.record.projectId !== projectId && loaded.record.projectId !== characterFindings[0]?.storyLocation.bookProjectId) {
      // Prefer the dossier home project for the package.
    }
    const homeProjectId = loaded.record.projectId;
    let profile: CharacterDevelopment = loaded.profile;
    const suggestions: ProfileSuggestion[] = [];
    const observations: ReviewObservation[] = [];
    for (const finding of characterFindings) {
      const decision = decisions[finding.id] ?? emptyDecision();
      if (decision.action === "intentional") {
        observations.push({
          check: "personality",
          summary: `Marked intentional: ${finding.observation}`,
          evidence: finding.supportingEvidence.join(" "),
          uncertainty: finding.uncertaintyNote,
          suggestion: decision.reason || "Author marked this as intentional.",
        });
        continue;
      }
      if (!finding.sourceVerified) continue;
      const edited = decision.editedValue;
      const suggestion = findingToProfileSuggestion(finding, edited);
      if (suggestion) suggestions.push(suggestion);
      const observation = findingToReviewObservation(finding, edited || decision.editedNote);
      if (observation) observations.push(observation);
    }
    if (suggestions.length) profile = applyProfileSuggestions(profile, suggestions, (prefix) => newId("rec").replace(/^rec_/, `${prefix}_`));
    if (observations.length) {
      profile = {
        ...profile,
        reviewNotes: [...profile.reviewNotes, ...reviewNotesFromObservations(observations, (prefix) => newId("rec").replace(/^rec_/, `${prefix}_`))],
      };
    }

    const fields = withCharacterDevelopment(loaded.record.fields as JsonObject, profile);
    const packageId = newId("pkg");
    const pkg: ChangePackageV1 = {
      format: CHANGE_PACKAGE_FORMAT,
      formatVersion: CHANGE_PACKAGE_FORMAT_VERSION,
      packageId,
      workspaceId: (await db.project.findFirstOrThrow({ where: { id: homeProjectId } })).workspaceId,
      projectId: homeProjectId,
      summary: `Accepted character analysis findings for ${loaded.record.title}`,
      source: { conversationLabel: `character-analysis:${runId}` },
      approval: { status: "approved", statement: "Author accepted selected character analysis findings as draft notes." },
      scope: "reference",
      protectedOverrides: loaded.record.protected ? [characterId] : [],
      operations: [
        {
          op: "update_record",
          recordId: characterId,
          expectedRevision: loaded.record.currentRevision,
          changes: {
            fields: {
              set: { [CHARACTER_DEVELOPMENT_KEY]: fields[CHARACTER_DEVELOPMENT_KEY] as JsonObject },
            },
          },
          note: "Draft notes from character analysis. Not canon until separately approved.",
        },
      ],
      relatedRecords: characterFindings.map((finding) => ({
        recordId: characterId,
        note: `${finding.action}: ${finding.observation.slice(0, 200)}`,
      })),
    };

    await db.characterAnalysisRun.update({ where: { id: runId }, data: { status: "applying" } });
    lastOutcome = await applyChangePackage(db, pkg, { projectId: homeProjectId }, { confirmProtected: options.confirmProtected });
    if (lastOutcome.status === "rejected") {
      await db.characterAnalysisRun.update({
        where: { id: runId },
        data: { status: "proposed", errorCode: "apply_rejected", errorMessage: lastOutcome.issues[0]?.message ?? "Apply was rejected." },
      });
      return { outcome: lastOutcome, run: await getCharacterAnalysis(db, projectId, runId) };
    }
    packageIds.push(packageId);
    for (const finding of characterFindings) {
      decisions[finding.id] = applyFindingDecision(decisions[finding.id], {
        action: decisions[finding.id]?.action ?? "accept",
        appliedPackageId: packageId,
      });
    }
  }

  await db.characterAnalysisRun.update({
    where: { id: runId },
    data: {
      status: "applied",
      decisionsJson: JSON.stringify(decisions),
      appliedPackageIdsJson: JSON.stringify(packageIds),
      completedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    },
  });
  return {
    outcome: lastOutcome ?? { status: "rejected", issues: [] },
    run: await getCharacterAnalysis(db, projectId, runId),
  };
}

export async function requestFurtherAnalysis(
  db: Db,
  runtime: AssistantRuntime,
  projectId: string,
  runId: string,
  findingId: string,
): Promise<PreparedCharacterAnalysis> {
  const run = await getCharacterAnalysis(db, projectId, runId);
  const finding = run.findings.find((item) => item.id === findingId);
  if (!finding) throw new AssistantError("INVALID_REQUEST", "That finding is not in this analysis.");
  const scopeSpec: CharacterAnalysisScopeSpec = {
    ...run.scopeSpec,
    chapterRecordId: finding.storyLocation.chapterRecordId,
    sceneRecordId: finding.storyLocation.sceneRecordId,
    bookProjectIds: finding.storyLocation.bookProjectId ? [finding.storyLocation.bookProjectId] : run.scopeSpec.bookProjectIds,
  };
  const scopeKind: CharacterAnalysisScopeKind = finding.storyLocation.sceneRecordId
    ? "scene"
    : finding.storyLocation.chapterRecordId
      ? "chapter"
      : "book";
  await saveCharacterAnalysisDecision(db, projectId, runId, findingId, {
    action: "further_analysis",
    reason: "Further analysis requested",
  });
  return prepareCharacterAnalysis(db, runtime, {
    projectId,
    characterRecordIds: [finding.characterRecordId],
    scopeKind,
    scopeSpec,
    actions: [finding.action],
  });
}
