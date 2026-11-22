import {
  developmentIsEmpty,
  readCharacterDevelopment,
  renderCharacterContextSlice,
  type CharacterDevelopment,
  type NarrativePoint,
} from "@/domain/characterDevelopment";
import {
  collectCharacterContinuityFindings,
  summarizeKnowledgeOmissions,
  writingContextPolicy,
  type AssembledCharacterContextMeta,
  type CharacterContinuityFinding,
  type WritingContextMode,
} from "@/domain/characterWritingContext";
import { parseJsonObject } from "@/domain/json";
import type { OrderEdge } from "@/world/storyOrder";
import type { Db, DbOrTx } from "../db";
import { listCharacterProfiles } from "./characterDevelopmentService";
import { LIVE_RECORD } from "./trashFilters";

/*
 * Point-scoped Living Character context for writing and editorial AI.
 * Selects linked / named characters only — never dumps every dossier.
 */

export interface FocusManuscript {
  recordId: string;
  type: string;
  title: string;
  parentRecordId: string | null;
  projectId: string;
  draftId: string | null;
}

export async function narrativePointForManuscript(
  db: DbOrTx,
  projectId: string,
  focus: FocusManuscript | null,
): Promise<{ point: NarrativePoint; edges: OrderEdge[] }> {
  const edgesRows = await db.storyEventOrder.findMany({
    where: { projectId },
    select: { earlierEventId: true, laterEventId: true },
  });
  const edges: OrderEdge[] = edgesRows.map((row) => ({ earlierId: row.earlierEventId, laterId: row.laterEventId }));
  if (!focus) {
    return { point: { bookProjectId: projectId, storyEventId: null, sequence: null }, edges };
  }
  const chapterId =
    focus.type === "manuscript_chapter"
      ? focus.recordId
      : focus.type === "manuscript_scene"
        ? focus.parentRecordId
        : focus.parentRecordId;
  const sceneId = focus.type === "manuscript_scene" ? focus.recordId : null;
  const link = await db.storyEventScene.findFirst({
    where: {
      projectId,
      manuscriptRecordId: focus.recordId,
    },
    select: { eventId: true },
    orderBy: { id: "asc" },
  });
  return {
    point: {
      bookProjectId: focus.projectId || projectId,
      storyEventId: link?.eventId ?? null,
      sequence: null,
      chapterRecordId: chapterId,
      sceneRecordId: sceneId,
      boundary: "at_point",
    },
    edges,
  };
}

export async function loadFocusManuscript(db: DbOrTx, projectId: string, recordId: string | null | undefined): Promise<FocusManuscript | null> {
  if (!recordId) return null;
  const row = await db.record.findFirst({
    where: { id: recordId, projectId, ...LIVE_RECORD },
    select: { id: true, type: true, title: true, parentRecordId: true, projectId: true, draftId: true },
  });
  if (!row) return null;
  if (row.type !== "manuscript_chapter" && row.type !== "manuscript_scene" && row.type !== "scene_note") return null;
  return {
    recordId: row.id,
    type: row.type,
    title: row.title,
    parentRecordId: row.parentRecordId,
    projectId: row.projectId,
    draftId: row.draftId,
  };
}

async function linkedCharacterIds(db: DbOrTx, projectId: string, manuscriptRecordId: string | null): Promise<string[]> {
  if (!manuscriptRecordId) return [];
  const links = await db.recordLink.findMany({
    where: {
      projectId,
      OR: [{ fromRecordId: manuscriptRecordId }, { toRecordId: manuscriptRecordId }],
    },
    select: { fromRecordId: true, toRecordId: true },
  });
  const ids = new Set<string>();
  for (const link of links) {
    ids.add(link.fromRecordId);
    ids.add(link.toRecordId);
  }
  ids.delete(manuscriptRecordId);
  const dossiers = await db.record.findMany({
    where: { id: { in: [...ids] }, projectId, type: "character_dossier", ...LIVE_RECORD },
    select: { id: true },
  });
  return dossiers.map((row) => row.id);
}

function nameHits(body: string, title: string, aliases: unknown): boolean {
  const hay = body.normalize("NFC").toLowerCase();
  const names = [title, ...(Array.isArray(aliases) ? aliases.filter((item): item is string => typeof item === "string") : [])];
  return names.some((name) => {
    const needle = name.normalize("NFC").trim().toLowerCase();
    return needle.length >= 2 && hay.includes(needle);
  });
}

/**
 * Relevant character dossiers for a writing focus: linked first, then name
 * mentions in the focus body (capped). Never returns every series dossier.
 */
export async function selectRelevantCharacterIds(
  db: DbOrTx,
  projectId: string,
  focus: FocusManuscript | null,
  options: { limit?: number; explicitIds?: string[] } = {},
): Promise<string[]> {
  const limit = options.limit ?? 8;
  if (options.explicitIds?.length) return [...new Set(options.explicitIds)].slice(0, limit);
  const linked = await linkedCharacterIds(db, projectId, focus?.recordId ?? null);
  if (linked.length >= limit || !focus) return linked.slice(0, limit);

  const focusRow = await db.record.findFirst({
    where: { id: focus.recordId, projectId },
    select: { body: true },
  });
  const body = focusRow?.body ?? "";
  const profiles = await listCharacterProfiles(db, projectId);
  const mentioned: string[] = [];
  for (const profile of profiles) {
    if (linked.includes(profile.id)) continue;
    const fields = profile.record.fields;
    if (nameHits(body, profile.title, fields.aliases)) mentioned.push(profile.id);
    if (linked.length + mentioned.length >= limit) break;
  }
  return [...linked, ...mentioned].slice(0, limit);
}

export interface RenderedCharacterContext {
  recordId: string;
  title: string;
  text: string;
  meta: AssembledCharacterContextMeta;
}

export async function assembleCharacterWritingContexts(
  db: DbOrTx,
  projectId: string,
  input: {
    focusRecordId?: string | null;
    mode?: WritingContextMode;
    allowFuturePlans?: boolean;
    characterRecordIds?: string[];
    limit?: number;
  },
): Promise<{ point: NarrativePoint; edges: OrderEdge[]; contexts: RenderedCharacterContext[] }> {
  const focus = await loadFocusManuscript(db, projectId, input.focusRecordId);
  const { point, edges } = await narrativePointForManuscript(db, projectId, focus);
  const policy = writingContextPolicy(input.mode ?? "editorial", input.allowFuturePlans === true);
  const ids = await selectRelevantCharacterIds(db, projectId, focus, {
    limit: input.limit,
    explicitIds: input.characterRecordIds,
  });
  const profiles = await listCharacterProfiles(db, projectId);
  const byId = new Map(profiles.map((row) => [row.id, row]));
  const contexts: RenderedCharacterContext[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || developmentIsEmpty(row.profile)) continue;
    const text = renderCharacterContextSlice({
      title: row.title,
      body: row.body,
      profile: row.profile,
      slice: policy.slice,
      bookProjectId: point.bookProjectId,
      point,
      edges,
      knowledgeHolders: policy.knowledgeHolders,
      includePlannedKnowledge: policy.includePlanned,
    });
    const omissions = summarizeKnowledgeOmissions(row.profile, point, edges, policy);
    const state = collectCharacterContinuityFindings({
      characterRecordId: id,
      characterTitle: row.title,
      profile: row.profile,
      point,
      edges,
    });
    contexts.push({
      recordId: id,
      title: row.title,
      text,
      meta: {
        characterRecordId: id,
        title: row.title,
        slice: policy.slice,
        mode: policy.mode,
        point,
        ...omissions,
        stateConflicts: state.filter((item) => item.kind === "character_state_conflict").length,
      },
    });
  }
  return { point, edges, contexts };
}

export function characterContextFromFields(input: {
  title: string;
  body: string;
  fieldsJson: string;
  projectId: string;
  point?: NarrativePoint | null;
  edges?: readonly OrderEdge[];
  mode?: WritingContextMode;
  allowFuturePlans?: boolean;
}): string | null {
  const fields = parseJsonObject(input.fieldsJson);
  const read = readCharacterDevelopment(fields);
  if (developmentIsEmpty(read.profile)) return null;
  const policy = writingContextPolicy(input.mode ?? "editorial", input.allowFuturePlans === true);
  const point = input.point ?? { bookProjectId: input.projectId, storyEventId: null, sequence: null };
  return renderCharacterContextSlice({
    title: input.title,
    body: input.body,
    profile: read.profile,
    slice: policy.slice,
    bookProjectId: point.bookProjectId,
    point,
    edges: input.edges ?? [],
    knowledgeHolders: policy.knowledgeHolders,
    includePlannedKnowledge: policy.includePlanned,
  });
}

export async function characterContinuityFindingsForProject(
  db: DbOrTx,
  projectId: string,
  options: { recordId?: string | null; focusRecordId?: string | null } = {},
): Promise<CharacterContinuityFinding[]> {
  const focus = await loadFocusManuscript(db, projectId, options.focusRecordId ?? options.recordId);
  const { point, edges } = await narrativePointForManuscript(db, projectId, focus);
  const profiles = await listCharacterProfiles(db, projectId);
  let allowed: Set<string> | null = null;
  if (options.recordId) {
    const asDossier = profiles.find((row) => row.id === options.recordId);
    if (asDossier) allowed = new Set([asDossier.id]);
    else if (focus) allowed = new Set(await selectRelevantCharacterIds(db, projectId, focus, { limit: 20 }));
  }
  const findings: CharacterContinuityFinding[] = [];
  for (const row of profiles) {
    if (allowed && !allowed.has(row.id)) continue;
    if (developmentIsEmpty(row.profile)) continue;
    findings.push(
      ...collectCharacterContinuityFindings({
        characterRecordId: row.id,
        characterTitle: row.title,
        profile: row.profile,
        point,
        edges,
      }),
    );
  }
  return findings;
}

export type { CharacterDevelopment };
