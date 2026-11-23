/**
 * W7B: author-triggered review of manuscript passages vs approved world facts
 * at the scene/chapter story point. Never edits prose or canon.
 */

import type { NarrativePoint } from "@/domain/characterDevelopment";
import { newId } from "@/domain/ids";
import {
  formatWorldProfileFieldValue,
  isWorldProfileRecordType,
  readWorldProfile,
  type WorldProfileFieldValue,
} from "@/domain/worldProfile";
import { resolveWorldFieldsAtPoint } from "@/domain/worldProfileHistory";
import {
  evaluatePassageAgainstWorldFact,
  findingsToPersist,
  splitPassageClaims,
  validateAiContradictionCandidate,
  type AiContradictionCandidate,
  type ContradictionEvaluation,
  type WorldFactSnapshot,
} from "@/domain/worldContradiction";
import { renderWorldContextSlice } from "@/domain/worldWritingContext";
import { aliasesOf, nameFormsOf } from "@/writing/crossRefs";
import { resolveRecordTaxonomy } from "@/world/taxonomy";
import type { Db, DbOrTx, Tx } from "../db";
import {
  loadFocusManuscript,
  narrativePointForManuscript,
} from "./characterWritingContextService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { errorIssue } from "@/domain/issues";
import { listLinkedReferences } from "./linkService";
import { listSceneLocationsForManuscript } from "./sceneLocationService";
import { listAvailableReferences, resolveAvailableReference } from "./seriesBibleService";
import { booksFromIds } from "./worldWritingContextService";
import { LIVE_RECORD } from "./trashFilters";

export interface WorldContradictionCheckView {
  id: string;
  issueKey: string;
  dedupeKey: string;
  manuscriptRecordId: string;
  manuscriptRevision: number;
  passageStart: number;
  passageEnd: number;
  passageExcerpt: string;
  passageHash: string;
  worldRecordId: string;
  worldRecordRevision: number;
  fieldPath: string;
  changeId: string;
  storyPointLabel: string;
  storyPoint: NarrativePoint | null;
  verdict: "conflict" | "ambiguous";
  stance: string;
  explanation: string;
  worldFactFormatted: string;
  needsRecheck: boolean;
  checkedAt: Date;
  worldTitle?: string;
  manuscriptTitle?: string;
}

export interface ReviewManuscriptContradictionsResult {
  point: NarrativePoint;
  storyPointLabel: string;
  evaluations: ContradictionEvaluation[];
  persisted: WorldContradictionCheckView[];
  eligibleFactCount: number;
}

function storyPointLabelOf(point: NarrativePoint): string {
  const bits: string[] = [];
  if (point.boundary && point.boundary !== "at_point") bits.push(point.boundary.replace(/_/g, " "));
  if (point.storyEventId) bits.push(`event ${point.storyEventId}`);
  if (point.sceneRecordId) bits.push(`scene ${point.sceneRecordId}`);
  else if (point.chapterRecordId) bits.push(`chapter ${point.chapterRecordId}`);
  if (point.bookProjectId) bits.push(`book ${point.bookProjectId}`);
  return bits.join(" · ") || "unanchored story point";
}

export async function markWorldContradictionNeedsRecheckForSourceInTx(
  tx: Tx,
  projectId: string,
  recordId: string,
  _newRevision: number,
): Promise<void> {
  if (!("worldContradictionCheck" in tx) || !(tx as { worldContradictionCheck?: unknown }).worldContradictionCheck) {
    return;
  }
  await tx.worldContradictionCheck.updateMany({
    where: {
      projectId,
      needsRecheck: false,
      OR: [{ manuscriptRecordId: recordId }, { worldRecordId: recordId }],
    },
    data: { needsRecheck: true },
  });
}

function toView(
  row: {
    id: string;
    issueKey: string;
    dedupeKey: string;
    manuscriptRecordId: string;
    manuscriptRevision: number;
    passageStart: number;
    passageEnd: number;
    passageExcerpt: string;
    passageHash: string;
    worldRecordId: string;
    worldRecordRevision: number;
    fieldPath: string;
    changeId: string;
    storyPointJson: string;
    storyPointLabel: string;
    verdict: string;
    stance: string;
    explanation: string;
    worldFactFormatted: string;
    needsRecheck: boolean;
    checkedAt: Date;
  },
  titles?: { worldTitle?: string; manuscriptTitle?: string },
): WorldContradictionCheckView {
  let storyPoint: NarrativePoint | null = null;
  try {
    storyPoint = JSON.parse(row.storyPointJson) as NarrativePoint;
  } catch {
    storyPoint = null;
  }
  return {
    id: row.id,
    issueKey: row.issueKey,
    dedupeKey: row.dedupeKey,
    manuscriptRecordId: row.manuscriptRecordId,
    manuscriptRevision: row.manuscriptRevision,
    passageStart: row.passageStart,
    passageEnd: row.passageEnd,
    passageExcerpt: row.passageExcerpt,
    passageHash: row.passageHash,
    worldRecordId: row.worldRecordId,
    worldRecordRevision: row.worldRecordRevision,
    fieldPath: row.fieldPath,
    changeId: row.changeId,
    storyPointLabel: row.storyPointLabel,
    storyPoint,
    verdict: row.verdict === "ambiguous" ? "ambiguous" : "conflict",
    stance: row.stance,
    explanation: row.explanation,
    worldFactFormatted: row.worldFactFormatted,
    needsRecheck: row.needsRecheck,
    checkedAt: row.checkedAt,
    worldTitle: titles?.worldTitle,
    manuscriptTitle: titles?.manuscriptTitle,
  };
}

export async function listWorldContradictionChecks(
  db: DbOrTx,
  projectId: string,
  options: { manuscriptRecordId?: string | null } = {},
): Promise<WorldContradictionCheckView[]> {
  if (!("worldContradictionCheck" in db)) return [];
  const rows = await db.worldContradictionCheck.findMany({
    where: {
      projectId,
      ...(options.manuscriptRecordId ? { manuscriptRecordId: options.manuscriptRecordId } : {}),
    },
    orderBy: [{ checkedAt: "desc" }, { id: "asc" }],
  });
  return rows.map((row) => toView(row));
}

async function collectWorldCandidateIds(
  db: DbOrTx,
  projectId: string,
  manuscriptRecordId: string,
  body: string,
): Promise<string[]> {
  const ids = new Set<string>();
  const linked = await listLinkedReferences(db, projectId, manuscriptRecordId);
  for (const link of linked) ids.add(link.recordId);

  const locations = await listSceneLocationsForManuscript(db, projectId, manuscriptRecordId);
  for (const loc of locations.locations) ids.add(loc.locationRecordId);

  const available = await listAvailableReferences(db, projectId, { linkableOnly: true });
  for (const entry of available) {
    if (!isWorldProfileRecordType(entry.record.type)) continue;
    const forms = nameFormsOf({
      title: entry.record.title,
      type: entry.record.type,
      fields: entry.record.fields as Record<string, unknown>,
    });
    const hay = body;
    for (const term of [...forms.full, ...forms.parts]) {
      if (term.length >= 2 && hay.includes(term)) {
        ids.add(entry.record.id);
        break;
      }
    }
  }
  return [...ids];
}

async function buildEligibleSnapshots(
  db: DbOrTx,
  projectId: string,
  worldRecordIds: readonly string[],
  point: NarrativePoint,
  edges: Parameters<typeof resolveWorldFieldsAtPoint>[2],
  bookIds: readonly string[],
  storyPointLabel: string,
): Promise<{ snapshots: WorldFactSnapshot[]; eligibleFactCount: number }> {
  const books = booksFromIds(bookIds);
  const snapshots: WorldFactSnapshot[] = [];
  let eligibleFactCount = 0;

  for (const worldRecordId of worldRecordIds) {
    const available = await resolveAvailableReference(db, projectId, worldRecordId);
    if (!available) continue;
    if (!isWorldProfileRecordType(available.record.type)) continue;
    const fields = available.record.fields as Record<string, unknown>;
    const profile = readWorldProfile(fields).profile;
    const taxonomy = resolveRecordTaxonomy({ type: available.record.type, fields });
    const subcategoryId = taxonomy.primary?.subcategory ?? null;

    // Ensure W7A drafting path would also accept this reference (side-effect free).
    renderWorldContextSlice({
      title: available.record.title,
      recordId: available.record.id,
      body: available.record.body,
      fields,
      mode: "drafting",
      point,
      edges: edges ?? [],
      books,
      viewingProjectId: projectId,
      homeLabel: available.home ? available.home.bookName || available.home.title : null,
    });

    const resolved = resolveWorldFieldsAtPoint(profile, point, edges ?? [], {
      books,
      viewingProjectId: projectId,
    });
    if (resolved.conflicts.length) continue;

    const aliases = aliasesOf(fields);
    for (const [fieldPath, value] of Object.entries(resolved.fields)) {
      if (value.presence !== "set") continue;
      eligibleFactCount += 1;
      snapshots.push({
        worldRecordId: available.record.id,
        worldTitle: available.record.title,
        worldAliases: aliases,
        fieldPath,
        subcategoryId,
        changeId: value.changeId,
        worldRecordRevision: available.record.currentRevision,
        value: value.value,
        formatted: value.formatted || formatWorldProfileFieldValue(value.value),
        storyPointLabel,
      });
    }
  }

  return { snapshots, eligibleFactCount };
}

export async function reviewManuscriptContradictions(
  db: Db,
  projectId: string,
  manuscriptRecordId: string,
  options: {
    persist?: boolean;
    aiCandidates?: readonly AiContradictionCandidate[];
  } = {},
): Promise<ReviewManuscriptContradictionsResult> {
  const focus = await loadFocusManuscript(db, projectId, manuscriptRecordId);
  if (!focus) {
    throw new MutationRejectedError([
      errorIssue("INVALID_CHANGE", "Choose a chapter or scene to review against world facts."),
    ]);
  }
  const manuscript = await db.record.findFirst({
    where: { id: manuscriptRecordId, projectId, ...LIVE_RECORD },
    select: { id: true, title: true, body: true, currentRevision: true, type: true },
  });
  if (!manuscript) throw new NotFoundError(`Record ${manuscriptRecordId} not found`);

  const { point, edges, bookIds } = await narrativePointForManuscript(db, projectId, focus);
  const label = storyPointLabelOf(point);
  const worldIds = await collectWorldCandidateIds(db, projectId, manuscriptRecordId, manuscript.body);
  const { snapshots, eligibleFactCount } = await buildEligibleSnapshots(
    db,
    projectId,
    worldIds,
    point,
    edges,
    bookIds,
    label,
  );

  const claims = splitPassageClaims(manuscript.body);
  const evaluations: ContradictionEvaluation[] = [];

  for (const claim of claims) {
    for (const fact of snapshots) {
      const result = evaluatePassageAgainstWorldFact({
        passage: claim,
        fact,
        manuscriptRecordId,
        manuscriptRevision: manuscript.currentRevision,
      });
      // Return comparable outcomes for the review payload; only conflict/ambiguous persist.
      if (
        result.verdict === "conflict" ||
        result.verdict === "ambiguous" ||
        result.verdict === "compatible" ||
        result.verdict === "scope_mismatch"
      ) {
        evaluations.push(result);
      }
    }
  }

  for (const candidate of options.aiCandidates ?? []) {
    const validated = validateAiContradictionCandidate({
      body: manuscript.body,
      candidate,
      eligibleFacts: snapshots,
    });
    if (!validated.ok) continue;
    const fact = snapshots.find(
      (item) =>
        item.worldRecordId === candidate.worldRecordId && item.fieldPath === candidate.fieldPath,
    );
    if (!fact) continue;
    const result = evaluatePassageAgainstWorldFact({
      passage: {
        text: validated.excerpt,
        start: validated.start,
        end: validated.end,
        stance: "narration",
      },
      fact,
      manuscriptRecordId,
      manuscriptRevision: manuscript.currentRevision,
    });
    if (result.verdict === "conflict" || result.verdict === "ambiguous") {
      evaluations.push(result);
    }
  }

  const toSave = findingsToPersist(evaluations);
  let persisted: WorldContradictionCheckView[] = [];

  if (options.persist) {
    persisted = await db.$transaction(async (tx) => {
      const keptDedupe = new Set(toSave.map((item) => item.dedupeKey));
      const existing = await tx.worldContradictionCheck.findMany({
        where: { projectId, manuscriptRecordId },
      });
      for (const row of existing) {
        if (!keptDedupe.has(row.dedupeKey)) {
          // Retire obsolete findings for this manuscript that no longer fail at these revisions.
          await tx.worldContradictionCheck.delete({ where: { id: row.id } });
        }
      }

      const out: WorldContradictionCheckView[] = [];
      for (const item of toSave) {
        const data = {
          issueKey: item.issueKey,
          manuscriptRecordId,
          manuscriptRevision: manuscript.currentRevision,
          passageStart: item.passage.start,
          passageEnd: item.passage.end,
          passageExcerpt: item.passage.text,
          passageHash: item.passageHash,
          worldRecordId: item.worldFact.worldRecordId,
          worldRecordRevision: item.worldFact.worldRecordRevision,
          fieldPath: item.worldFact.fieldPath,
          changeId: item.worldFact.changeId,
          storyPointJson: JSON.stringify(point),
          storyPointLabel: item.worldFact.storyPointLabel || label,
          verdict: item.verdict as "conflict" | "ambiguous",
          stance: item.stance,
          explanation: item.explanation,
          worldFactFormatted: item.worldFact.formatted,
          needsRecheck: false,
          checkedAt: new Date(),
        };
        const prior = await tx.worldContradictionCheck.findUnique({
          where: { projectId_dedupeKey: { projectId, dedupeKey: item.dedupeKey } },
        });
        const row = prior
          ? await tx.worldContradictionCheck.update({
              where: { id: prior.id },
              data,
            })
          : await tx.worldContradictionCheck.create({
              data: {
                id: newId("wcc"),
                projectId,
                dedupeKey: item.dedupeKey,
                ...data,
              },
            });
        out.push(
          toView(row, {
            worldTitle: item.worldFact.worldTitle,
            manuscriptTitle: manuscript.title,
          }),
        );
      }
      return out;
    });
  }

  return {
    point,
    storyPointLabel: label,
    evaluations,
    persisted,
    eligibleFactCount,
  };
}
