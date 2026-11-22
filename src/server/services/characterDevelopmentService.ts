import { checkSize, describeSizeProblem } from "@/assistant/prompt";
import type { AssistantProvider, OutputSchema } from "@/assistant/provider";
import {
  CHARACTER_DEVELOPMENT_KEY,
  applyProfileSuggestions,
  characterContextText,
  cuesForBeats,
  cuesForEvents,
  cuesForManuscript,
  developmentIsEmpty,
  dossierBodyHash,
  extractInstructions,
  inheritedTraits,
  parseProfileSuggestions,
  parseReviewObservations,
  PROFILE_SUGGESTION_JSON_SCHEMA,
  readCharacterDevelopment,
  reviewInstructions,
  REVIEW_OBSERVATION_JSON_SCHEMA,
  reviewNotesFromObservations,
  seriesMatrix,
  validateCharacterDevelopment,
  variantWouldCycle,
  withCharacterDevelopment,
  type CharacterDevelopment,
  type CharacterProfileSource,
  type DevelopmentCue,
  type NarrativePoint,
  type ProfileSuggestion,
  type ReviewObservation,
  type SeriesMatrixRow,
} from "@/domain/characterDevelopment";
import { errorIssue, type Issue } from "@/domain/issues";
import type { JsonObject } from "@/domain/json";
import { newId } from "@/domain/ids";
import { toRecordView, type RecordView } from "@/domain/records";
import { isRecordType } from "@/domain/recordTypes";
import type { OrderEdge } from "@/world/storyOrder";
import type { Db, DbOrTx } from "../db";
import { AssistantError, type AssistantRuntime } from "./assistantService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { listSeriesBookProjects } from "./projectService";
import { getRecord, updateRecord } from "./recordService";
import { getSeriesSharedRecord, listSeriesSharedRecords } from "./seriesBibleService";
import { LIVE_RECORD } from "./trashFilters";

const ACTOR_NOTE = "author";

export interface CharacterProfileRow extends CharacterProfileSource {
  record: RecordView;
  body: string;
  revision: number;
  homeLabel: string;
}

export async function listCharacterProfiles(db: DbOrTx, projectId: string): Promise<CharacterProfileRow[]> {
  const local = await db.record.findMany({
    where: { projectId, ...LIVE_RECORD, type: "character_dossier" },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
  const shared = await listSeriesSharedRecords(db, projectId);
  const rows: CharacterProfileRow[] = [];
  for (const row of local) {
    if (!isRecordType(row.type)) continue;
    const record = toRecordView(row);
    rows.push({
      id: record.id,
      title: record.title,
      projectId: record.projectId,
      profile: readCharacterDevelopment(record.fields).profile,
      record,
      body: record.body,
      revision: record.currentRevision,
      homeLabel: "This book",
    });
  }
  for (const item of shared) {
    if (item.record.type !== "character_dossier") continue;
    rows.push({
      id: item.record.id,
      title: item.record.title,
      projectId: item.record.projectId,
      profile: readCharacterDevelopment(item.record.fields).profile,
      record: item.record,
      body: item.record.body,
      revision: item.record.currentRevision,
      homeLabel: item.home.bookName?.trim() || item.home.title,
    });
  }
  return rows;
}

export async function loadCharacterDevelopment(db: DbOrTx, projectId: string, recordId: string): Promise<{
  record: RecordView;
  profile: CharacterDevelopment;
  problems: Issue[];
  foundation: CharacterProfileRow | null;
}> {
  const record = await getCharacterRecord(db, projectId, recordId);
  const read = readCharacterDevelopment(record.fields);
  const foundationId = read.profile.variant?.foundationRecordId ?? null;
  const foundation = foundationId ? await findProfile(db, projectId, foundationId) : null;
  return {
    record,
    profile: read.profile,
    problems: read.problems.map((problem) => errorIssue("INVALID_CHANGE", problem.message, { path: problem.path })),
    foundation,
  };
}

async function getCharacterRecord(db: DbOrTx, projectId: string, recordId: string): Promise<RecordView> {
  try {
    const record = await getRecord(db, projectId, recordId);
    if (record.type !== "character_dossier") throw new NotFoundError("Character development belongs on a character dossier.");
    return record;
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    const shared = await getSeriesSharedRecord(db, projectId, recordId);
    if (!shared || shared.record.type !== "character_dossier") throw new NotFoundError("Character dossier not found in this project.");
    return shared.record;
  }
}

async function findProfile(db: DbOrTx, projectId: string, recordId: string): Promise<CharacterProfileRow | null> {
  const profiles = await listCharacterProfiles(db, projectId);
  return profiles.find((profile) => profile.id === recordId) ?? null;
}

export async function saveCharacterDevelopment(
  db: Db,
  projectId: string,
  input: {
    recordId: string;
    expectedRevision: number;
    profile: CharacterDevelopment;
    unlockProtected?: boolean;
    /** Required to replace this book's already approved opening or closing state. */
    allowApprovedBookRewrite?: boolean;
  },
): Promise<{ revision: number; profile: CharacterDevelopment }> {
  const record = await getRecord(db, projectId, input.recordId);
  if (record.type !== "character_dossier") {
    throw new MutationRejectedError([errorIssue("INVALID_CHANGE", "Character development belongs on a character dossier.")]);
  }
  const problems = validateCharacterDevelopment(input.profile);
  if (problems.length) {
    throw new MutationRejectedError(problems.map((problem) => errorIssue("INVALID_CHANGE", problem.message, { path: problem.path })));
  }
  if (input.profile.variant) {
    const profiles = await listCharacterProfiles(db, projectId);
    const links = profiles.flatMap((profile) =>
      profile.profile.variant ? [{ recordId: profile.id, foundationRecordId: profile.profile.variant.foundationRecordId }] : [],
    );
    const nextLinks = [
      ...links.filter((link) => link.recordId !== record.id),
      { recordId: record.id, foundationRecordId: input.profile.variant.foundationRecordId },
    ];
    if (variantWouldCycle(nextLinks, record.id, input.profile.variant.foundationRecordId)) {
      throw new MutationRejectedError([errorIssue("INVALID_CHANGE", "A variant cannot inherit from itself or from a variant that leads back to it.")]);
    }
    const foundation = profiles.find((profile) => profile.id === input.profile.variant?.foundationRecordId);
    if (!foundation || foundation.id === record.id) {
      throw new MutationRejectedError([
        errorIssue("INVALID_REFERENCE", "The foundation dossier must be another character in this book or series."),
      ]);
    }
  }
  const previous = readCharacterDevelopment(record.fields).profile;
  const guarded = guardApprovedBookStates(previous, input.profile, input.allowApprovedBookRewrite === true);
  if (!guarded.ok) throw new MutationRejectedError([errorIssue("INVALID_CHANGE", guarded.message)]);
  const fields = withCharacterDevelopment(record.fields, input.profile);
  const batch = await updateRecord(db, projectId, {
    recordId: record.id,
    expectedRevision: input.expectedRevision,
    fields,
    unlockProtected: input.unlockProtected,
  });
  const saved = batch.records.find((item) => item.id === record.id);
  return { revision: saved?.currentRevision ?? input.expectedRevision + 1, profile: input.profile };
}

function guardApprovedBookStates(
  previous: CharacterDevelopment,
  next: CharacterDevelopment,
  allow: boolean,
): { ok: true } | { ok: false; message: string } {
  if (allow) return { ok: true };
  for (const book of previous.bookStates) {
    const replacement = next.bookStates.find((item) => item.projectId === book.projectId);
    if (!replacement) {
      if (book.openingApproval === "approved" || book.closingApproval === "approved") {
        return { ok: false, message: "Removing an approved book state needs confirmation." };
      }
      continue;
    }
    if (book.openingApproval === "approved" && JSON.stringify(book.opening) !== JSON.stringify(replacement.opening)) {
      return { ok: false, message: "Approved opening state in another save stays until you confirm the rewrite." };
    }
    if (book.closingApproval === "approved" && JSON.stringify(book.closing) !== JSON.stringify(replacement.closing)) {
      return { ok: false, message: "Approved closing state stays until you confirm the rewrite." };
    }
  }
  return { ok: true };
}

export async function loadSeriesDevelopment(db: DbOrTx, projectId: string): Promise<{
  books: Array<{ id: string; label: string }>;
  rows: SeriesMatrixRow[];
  characters: CharacterProfileRow[];
  standalone: boolean;
}> {
  const project = await db.project.findFirst({ where: { id: projectId }, select: { id: true, title: true, bookName: true, seriesName: true } });
  if (!project) throw new NotFoundError("Project not found");
  const siblings = await listSeriesBookProjects(db, projectId);
  const books = siblings.length
    ? siblings.map((book) => ({ id: book.id, label: book.bookName?.trim() || book.title }))
    : [{ id: project.id, label: project.bookName?.trim() || project.title }];
  const characters = await listCharacterProfiles(db, projectId);
  return {
    books,
    rows: seriesMatrix(characters, books.map((book) => book.id)),
    characters,
    standalone: !project.seriesName,
  };
}

export async function developmentCuesForBeats(db: DbOrTx, projectId: string, beatIds: readonly string[]): Promise<DevelopmentCue[]> {
  const characters = await listCharacterProfiles(db, projectId);
  return cuesForBeats(characters, new Set(beatIds), projectId);
}

export async function developmentCuesForEvents(db: DbOrTx, projectId: string, eventIds: readonly string[]): Promise<DevelopmentCue[]> {
  const characters = await listCharacterProfiles(db, projectId);
  return cuesForEvents(characters, new Set(eventIds), projectId);
}

export async function developmentCuesForManuscript(db: DbOrTx, projectId: string, manuscriptRecordId: string): Promise<DevelopmentCue[]> {
  const [characters, links, orders] = await Promise.all([
    listCharacterProfiles(db, projectId),
    db.storyEventScene.findMany({ where: { projectId, manuscriptRecordId }, select: { eventId: true } }),
    db.storyEventOrder.findMany({ where: { projectId }, select: { earlierEventId: true, laterEventId: true } }),
  ]);
  const edges: OrderEdge[] = orders.map((order) => ({ earlierId: order.earlierEventId, laterId: order.laterEventId }));
  const point: NarrativePoint = {
    bookProjectId: projectId,
    storyEventId: links[0]?.eventId ?? null,
    sequence: null,
  };
  return cuesForManuscript(characters, manuscriptRecordId, point, edges, projectId);
}

export function visibleTraits(profile: CharacterDevelopment, foundation: CharacterDevelopment | null) {
  return inheritedTraits(profile, foundation);
}

export function profileExport(record: { title: string; fields: JsonObject }): JsonObject | null {
  const read = readCharacterDevelopment(record.fields);
  if (developmentIsEmpty(read.profile)) return null;
  return { title: record.title, [CHARACTER_DEVELOPMENT_KEY]: read.profile as unknown as JsonObject };
}

function suggestionId(): string {
  return newId("rec").replace(/^rec_/, "cdev_");
}

export async function proposeCharacterProfile(
  provider: AssistantProvider,
  runtime: AssistantRuntime & { model: string },
  input: { title: string; body: string; profile: CharacterDevelopment },
  signal: AbortSignal,
): Promise<ProfileSuggestion[]> {
  const text = characterContextText({ title: input.title, body: input.body, profile: input.profile, passages: [] });
  assertContextSize(runtime, extractInstructions().length + text.length);
  const result = await provider.structured(
    {
      model: runtime.model,
      instructions: extractInstructions(),
      input: [{ role: "user", content: text }],
      maxOutputTokens: Math.min(runtime.limits.maxOutputTokens, 2000),
      timeoutMs: runtime.limits.requestTimeoutSeconds * 1000,
    },
    { name: "character_profile_suggestions", schema: PROFILE_SUGGESTION_JSON_SCHEMA as unknown as OutputSchema["schema"] },
    signal,
  );
  if (result.status !== "complete") {
    throw new AssistantError("INVALID_REQUEST", "The model did not return a usable profile suggestion. Nothing was saved.");
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(result.text);
  } catch {
    throw new AssistantError("INVALID_REQUEST", "The model did not return a usable profile suggestion. Nothing was saved.");
  }
  const parsed = parseProfileSuggestions(parsedJson);
  if (!parsed.ok) throw new AssistantError("INVALID_REQUEST", parsed.message);
  return parsed.suggestions;
}

export async function reviewCharacterConsistency(
  provider: AssistantProvider,
  runtime: AssistantRuntime & { model: string },
  input: {
    title: string;
    body: string;
    profile: CharacterDevelopment;
    passages: readonly { label: string; excerpt: string }[];
  },
  signal: AbortSignal,
): Promise<ReviewObservation[]> {
  const text = characterContextText(input);
  assertContextSize(runtime, reviewInstructions().length + text.length);
  const result = await provider.structured(
    {
      model: runtime.model,
      instructions: reviewInstructions(),
      input: [{ role: "user", content: text }],
      maxOutputTokens: Math.min(runtime.limits.maxOutputTokens, 2000),
      timeoutMs: runtime.limits.requestTimeoutSeconds * 1000,
    },
    { name: "character_consistency_review", schema: REVIEW_OBSERVATION_JSON_SCHEMA as unknown as OutputSchema["schema"] },
    signal,
  );
  if (result.status !== "complete") {
    throw new AssistantError("INVALID_REQUEST", "The model did not return a usable review. Nothing was saved.");
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(result.text);
  } catch {
    throw new AssistantError("INVALID_REQUEST", "The model did not return a usable review. Nothing was saved.");
  }
  const parsed = parseReviewObservations(parsedJson);
  if (!parsed.ok) throw new AssistantError("INVALID_REQUEST", parsed.message);
  return parsed.observations;
}

export function acceptProfileSuggestions(profile: CharacterDevelopment, accepted: readonly ProfileSuggestion[]): CharacterDevelopment {
  return applyProfileSuggestions(profile, accepted, () => suggestionId());
}

export function acceptReviewNotes(profile: CharacterDevelopment, observations: readonly ReviewObservation[]): CharacterDevelopment {
  return {
    ...profile,
    reviewNotes: [...profile.reviewNotes, ...reviewNotesFromObservations(observations, () => suggestionId())],
  };
}

function assertContextSize(runtime: AssistantRuntime, chars: number) {
  const size = checkSize(
    { totalChars: chars, items: [{ label: "This character", chars }] },
    runtime.limits.maxInputChars,
  );
  if (size) throw new AssistantError("TOO_LARGE", describeSizeProblem(size), size);
}

export const characterDevelopmentActor = ACTOR_NOTE;

export function passageHash(excerpt: string): string {
  return dossierBodyHash(excerpt);
}
