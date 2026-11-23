/**
 * Optional structured Living World Profile overlay on non-character World
 * references (`fields.worldProfile`). The record stays the identity; Markdown
 * body stays authoritative freeform prose. Missing metadata means the
 * reference works as before. Version stays at 1; new keys are optional.
 * Unknown top-level keys are kept on save. Flat WORLD_KIND_FIELD_SPECS values
 * stay on top-level fields[key] and are never duplicated inside worldProfile.values.
 */

import type { JsonObject, JsonValue } from "@/domain/json";
import { isRecordType, type RecordType } from "@/domain/recordTypes";
import { AUTHORITY_STATUSES, isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import { RECORD_GROUPS } from "@/ui/navigation";

export const WORLD_PROFILE_KEY = "worldProfile";
export const WORLD_PROFILE_VERSION = 1 as const;

export const WORLD_PROFILE_KNOWN_KEYS = [
  "version",
  "definitionId",
  "summary",
  "values",
  "collections",
  "fieldMeta",
  "migrationHold",
  "fieldHistory",
] as const;

export const WORLD_PROFILE_PROVENANCE_ORIGINS = ["author", "imported", "extracted"] as const;
export type WorldProvenanceOrigin = (typeof WORLD_PROFILE_PROVENANCE_ORIGINS)[number];

export const WORLD_MIGRATION_HOLD_KINDS = [
  "conflict",
  "protected_unknowns",
  "proposed_unapproved",
  "unclassified",
  "continuity_notes",
] as const;
export type WorldMigrationHoldKind = (typeof WORLD_MIGRATION_HOLD_KINDS)[number];

/** Non-character World reference types that may carry a Living World Profile. */
export const WORLD_PROFILE_RECORD_TYPES = [
  "worldbuilding",
  "rules_glossary",
  "research_note",
  "canon_decision",
  "continuity_note",
  "reference_note",
] as const satisfies readonly RecordType[];

export type WorldProfileRecordType = (typeof WORLD_PROFILE_RECORD_TYPES)[number];

export function isWorldProfileRecordType(type: string): type is WorldProfileRecordType {
  return (WORLD_PROFILE_RECORD_TYPES as readonly string[]).includes(type);
}

export function isWorldReferenceType(type: string): boolean {
  return isRecordType(type) && (RECORD_GROUPS.world as readonly string[]).includes(type);
}

export interface WorldSourceRef {
  recordId?: string;
  revisionNumber?: number;
  excerpt?: string;
  startOffset?: number;
  endOffset?: number;
  heading?: string;
}

export interface WorldClaimProvenance {
  origin: WorldProvenanceOrigin;
  note: string;
  sourceHeading?: string;
  sourceBodyHash?: string | null;
  updatedAt?: string;
  sourceRefs?: WorldSourceRef[];
}

export interface WorldFieldAuthorityMeta {
  approval: AuthorityStatus;
  provenance: WorldClaimProvenance;
}

export interface WorldProfileCalendarDate {
  eraId?: string | null;
  year?: number | null;
  monthPosition?: number | null;
  day?: number | null;
  freeText?: string;
}

export interface WorldProfileRecordRef {
  recordId: string;
}

export type WorldProfileFieldValue =
  | string
  | number
  | boolean
  | string[]
  | WorldProfileRecordRef
  | WorldProfileCalendarDate
  | null;

export interface WorldProfileCollectionItem {
  id: string;
  fields: Record<string, WorldProfileFieldValue>;
  approval: AuthorityStatus;
  provenance: WorldClaimProvenance;
  sourceRefs?: WorldSourceRef[];
  /** Unknown keys preserved on save. */
  [extra: string]: unknown;
}

export interface WorldMigrationHoldItem {
  id: string;
  kind: WorldMigrationHoldKind;
  fieldPath: string;
  heading: string;
  text: string;
  sourceText: string;
  note: string;
  decision: "retained" | "deferred";
}

/** Dated story-time change for one world field path. Undated current values stay elsewhere. */
export interface WorldFieldHistoryChange {
  id: string;
  fieldPath: string;
  definitionId: string | null;
  storage: "flat" | "profile" | "summary";
  presence: "set" | "unknown";
  value: WorldProfileFieldValue;
  approval: AuthorityStatus;
  planned: boolean;
  provenance: WorldClaimProvenance;
  bookProjectId: string | null;
  storyEventId: string | null;
  chapterRecordId: string | null;
  sceneRecordId: string | null;
  sequence: number | null;
  worldScope: "book" | "series";
  note: string;
  calendarLabel?: string;
  supersedesId: string | null;
  correctionNote: string;
  correctedAt: string | null;
}

export interface WorldProfile {
  version: 1;
  definitionId: string | null;
  summary: string;
  values: Record<string, WorldProfileFieldValue>;
  collections: Record<string, WorldProfileCollectionItem[]>;
  fieldMeta: Record<string, WorldFieldAuthorityMeta>;
  migrationHold: WorldMigrationHoldItem[];
  /** Optional dated changes; missing means no story chronology yet. */
  fieldHistory: WorldFieldHistoryChange[];
}

export interface WorldProfileProblem {
  path: string;
  message: string;
}

const MAX_SUMMARY = 2000;
const MAX_STRING = 20_000;
const MAX_LIST = 64;
const MAX_COLLECTIONS = 32;
const MAX_COLLECTION_ITEMS = 64;
const MAX_HOLDS = 200;
const MAX_FIELD_META = 500;
const MAX_FIELD_HISTORY = 500;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,120}$/;
const WORLD_HISTORY_SCOPES = ["book", "series"] as const;
const WORLD_HISTORY_STORAGE = ["flat", "profile", "summary"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown, max = MAX_STRING): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").slice(0, max);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function approvalOf(value: unknown): AuthorityStatus {
  return typeof value === "string" && isAuthorityStatus(value) ? value : "draft";
}

function idOf(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return ID_PATTERN.test(raw) ? raw.slice(0, 120) : fallback;
}

export function defaultWorldFieldMeta(origin: WorldProvenanceOrigin = "author"): WorldFieldAuthorityMeta {
  return {
    approval: "draft",
    provenance: { origin, note: "" },
  };
}

export function worldFieldMetaOf(profile: WorldProfile, fieldPath: string): WorldFieldAuthorityMeta {
  return profile.fieldMeta[fieldPath] ?? defaultWorldFieldMeta("author");
}

export function setWorldFieldMeta(
  profile: WorldProfile,
  fieldPath: string,
  meta: WorldFieldAuthorityMeta,
): WorldProfile {
  return {
    ...profile,
    fieldMeta: { ...profile.fieldMeta, [fieldPath]: meta },
  };
}

export function worldFieldIsApproved(profile: WorldProfile, fieldPath: string): boolean {
  return worldFieldMetaOf(profile, fieldPath).approval === "approved";
}

export function emptyWorldProfile(): WorldProfile {
  return {
    version: 1,
    definitionId: null,
    summary: "",
    values: {},
    collections: {},
    fieldMeta: {},
    migrationHold: [],
    fieldHistory: [],
  };
}

function readNullableId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function readFieldHistory(raw: unknown): WorldFieldHistoryChange[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_FIELD_HISTORY).flatMap((item, index) => {
    const row = asRecord(item);
    if (!row) return [];
    const fieldPath = text(row.fieldPath, 200);
    if (!fieldPath) return [];
    const storage = oneOf(row.storage, WORLD_HISTORY_STORAGE) ?? "profile";
    const presence = row.presence === "unknown" ? "unknown" : "set";
    const worldScope = oneOf(row.worldScope, WORLD_HISTORY_SCOPES) ?? "book";
    const sequence =
      typeof row.sequence === "number" && Number.isFinite(row.sequence) ? Math.floor(row.sequence) : null;
    const change: WorldFieldHistoryChange = {
      id: idOf(row.id, `wfh_${index}`),
      fieldPath,
      definitionId: readNullableId(row.definitionId),
      storage,
      presence,
      value: presence === "unknown" ? null : readWorldProfileFieldValue(row.value),
      approval: approvalOf(row.approval),
      planned: row.planned === true,
      provenance: readProvenance(row.provenance),
      bookProjectId: readNullableId(row.bookProjectId),
      storyEventId: readNullableId(row.storyEventId),
      chapterRecordId: readNullableId(row.chapterRecordId),
      sceneRecordId: readNullableId(row.sceneRecordId),
      sequence,
      worldScope,
      note: text(row.note, 500),
      supersedesId: readNullableId(row.supersedesId),
      correctionNote: text(row.correctionNote, 500),
      correctedAt: text(row.correctedAt, 64) || null,
    };
    const calendarLabel = text(row.calendarLabel, 200);
    if (calendarLabel) change.calendarLabel = calendarLabel;
    return [change];
  });
}

function readSourceRefs(raw: unknown): WorldSourceRef[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const out: WorldSourceRef[] = [];
  for (const item of raw.slice(0, 24)) {
    const row = asRecord(item);
    if (!row) continue;
    const ref: WorldSourceRef = {};
    if (typeof row.recordId === "string" && row.recordId.trim()) ref.recordId = row.recordId.trim().slice(0, 80);
    if (typeof row.revisionNumber === "number" && Number.isFinite(row.revisionNumber)) {
      ref.revisionNumber = Math.max(0, Math.floor(row.revisionNumber));
    }
    if (typeof row.excerpt === "string") ref.excerpt = text(row.excerpt, 500);
    if (typeof row.startOffset === "number" && Number.isFinite(row.startOffset)) {
      ref.startOffset = Math.max(0, Math.floor(row.startOffset));
    }
    if (typeof row.endOffset === "number" && Number.isFinite(row.endOffset)) {
      ref.endOffset = Math.max(0, Math.floor(row.endOffset));
    }
    if (typeof row.heading === "string") ref.heading = text(row.heading, 200);
    if (Object.keys(ref).length) out.push(ref);
  }
  return out.length ? out : undefined;
}

function readProvenance(raw: unknown): WorldClaimProvenance {
  const row = asRecord(raw);
  if (!row) return { origin: "author", note: "" };
  const provenance: WorldClaimProvenance = {
    origin: oneOf(row.origin, WORLD_PROFILE_PROVENANCE_ORIGINS) ?? "author",
    note: text(row.note, 500),
  };
  const heading = text(row.sourceHeading, 200);
  if (heading) provenance.sourceHeading = heading;
  if (row.sourceBodyHash === null) provenance.sourceBodyHash = null;
  else if (typeof row.sourceBodyHash === "string" && row.sourceBodyHash.trim()) {
    provenance.sourceBodyHash = row.sourceBodyHash.trim().slice(0, 128);
  }
  const updatedAt = text(row.updatedAt, 64);
  if (updatedAt) provenance.updatedAt = updatedAt;
  const sourceRefs = readSourceRefs(row.sourceRefs);
  if (sourceRefs) provenance.sourceRefs = sourceRefs;
  return provenance;
}

function readFieldMeta(raw: unknown): Record<string, WorldFieldAuthorityMeta> {
  const row = asRecord(raw);
  if (!row) return {};
  const out: Record<string, WorldFieldAuthorityMeta> = {};
  for (const [path, value] of Object.entries(row)) {
    if (Object.keys(out).length >= MAX_FIELD_META) break;
    const meta = asRecord(value);
    if (!meta) continue;
    out[path] = {
      approval: approvalOf(meta.approval),
      provenance: readProvenance(meta.provenance),
    };
  }
  return out;
}

function isCalendarDate(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  if (!keys.length) return false;
  return keys.every((key) =>
    ["eraId", "year", "monthPosition", "day", "freeText"].includes(key),
  );
}

export function readWorldProfileFieldValue(raw: unknown): WorldProfileFieldValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return text(raw);
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "boolean") return raw;
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is string => typeof item === "string")
      .map((item) => text(item, 500))
      .filter(Boolean)
      .slice(0, MAX_LIST);
  }
  const row = asRecord(raw);
  if (!row) return null;
  if (typeof row.recordId === "string" && row.recordId.trim() && Object.keys(row).every((k) => k === "recordId")) {
    return { recordId: row.recordId.trim().slice(0, 80) };
  }
  if (isCalendarDate(row)) {
    const date: WorldProfileCalendarDate = {};
    if (row.eraId === null) date.eraId = null;
    else if (typeof row.eraId === "string") date.eraId = row.eraId.trim().slice(0, 80) || null;
    if (row.year === null) date.year = null;
    else if (typeof row.year === "number" && Number.isFinite(row.year)) date.year = Math.floor(row.year);
    if (row.monthPosition === null) date.monthPosition = null;
    else if (typeof row.monthPosition === "number" && Number.isFinite(row.monthPosition)) {
      date.monthPosition = Math.floor(row.monthPosition);
    }
    if (row.day === null) date.day = null;
    else if (typeof row.day === "number" && Number.isFinite(row.day)) date.day = Math.floor(row.day);
    if (typeof row.freeText === "string") date.freeText = text(row.freeText, 200);
    return date;
  }
  return null;
}

function readValues(raw: unknown): Record<string, WorldProfileFieldValue> {
  const row = asRecord(raw);
  if (!row) return {};
  const out: Record<string, WorldProfileFieldValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!ID_PATTERN.test(key)) continue;
    out[key] = readWorldProfileFieldValue(value);
  }
  return out;
}

function readCollectionItems(raw: unknown): WorldProfileCollectionItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_COLLECTION_ITEMS).flatMap((item, index) => {
    const row = asRecord(item);
    if (!row) return [];
    const fields = readValues(row.fields);
    const entry: WorldProfileCollectionItem = {
      id: idOf(row.id, `wci_${index}`),
      fields,
      approval: approvalOf(row.approval),
      provenance: readProvenance(row.provenance),
    };
    const sourceRefs = readSourceRefs(row.sourceRefs);
    if (sourceRefs) entry.sourceRefs = sourceRefs;
    const known = new Set(["id", "fields", "approval", "provenance", "sourceRefs"]);
    for (const [key, value] of Object.entries(row)) {
      if (!known.has(key)) entry[key] = value;
    }
    return [entry];
  });
}

function readCollections(raw: unknown): Record<string, WorldProfileCollectionItem[]> {
  const row = asRecord(raw);
  if (!row) return {};
  const out: Record<string, WorldProfileCollectionItem[]> = {};
  for (const [key, value] of Object.entries(row)) {
    if (Object.keys(out).length >= MAX_COLLECTIONS) break;
    if (!ID_PATTERN.test(key)) continue;
    out[key] = readCollectionItems(value);
  }
  return out;
}

function readMigrationHold(raw: unknown): WorldMigrationHoldItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_HOLDS).flatMap((item, index) => {
    const row = asRecord(item);
    if (!row) return [];
    const kind = oneOf(row.kind, WORLD_MIGRATION_HOLD_KINDS);
    const textBody = text(row.text) || text(row.sourceText);
    if (!kind || !textBody) return [];
    return [
      {
        id: idOf(row.id, `wmhold_${index}`),
        kind,
        fieldPath: text(row.fieldPath, 200),
        heading: text(row.heading, 200),
        text: textBody,
        sourceText: text(row.sourceText) || textBody,
        note: text(row.note, 500),
        decision: row.decision === "deferred" ? "deferred" : "retained",
      },
    ];
  });
}

/**
 * True when stored worldProfile names a version this build cannot load.
 * Saves must refuse so an empty profile cannot wipe the stored object.
 */
export function unsupportedWorldProfileVersion(fields: Readonly<Record<string, unknown>>): boolean {
  const raw = fields[WORLD_PROFILE_KEY];
  if (raw === undefined || raw === null) return false;
  const row = asRecord(raw);
  if (!row) return false;
  return row.version !== undefined && row.version !== WORLD_PROFILE_VERSION;
}

export function readWorldProfile(fields: Readonly<Record<string, unknown>>): {
  profile: WorldProfile;
  problems: WorldProfileProblem[];
  ok: boolean;
} {
  const problems: WorldProfileProblem[] = [];
  if (!(WORLD_PROFILE_KEY in fields) || fields[WORLD_PROFILE_KEY] === undefined || fields[WORLD_PROFILE_KEY] === null) {
    return { profile: emptyWorldProfile(), problems, ok: true };
  }
  const row = asRecord(fields[WORLD_PROFILE_KEY]);
  if (!row) {
    problems.push({ path: WORLD_PROFILE_KEY, message: "World profile metadata is not an object." });
    return { profile: emptyWorldProfile(), problems, ok: false };
  }
  if (row.version !== undefined && row.version !== WORLD_PROFILE_VERSION) {
    problems.push({ path: `${WORLD_PROFILE_KEY}.version`, message: "This world profile version is not supported." });
    return { profile: emptyWorldProfile(), problems, ok: false };
  }
  const definitionId =
    row.definitionId === null || row.definitionId === undefined
      ? null
      : typeof row.definitionId === "string" && row.definitionId.trim()
        ? row.definitionId.trim().slice(0, 120)
        : null;
  if (row.definitionId !== undefined && row.definitionId !== null && definitionId === null) {
    problems.push({ path: `${WORLD_PROFILE_KEY}.definitionId`, message: "World profile definitionId must be a string or null." });
  }
  const fieldHistory = readFieldHistory(row.fieldHistory);
  const historyIds = new Set(fieldHistory.map((change) => change.id));
  for (const change of fieldHistory) {
    if (change.supersedesId && !historyIds.has(change.supersedesId)) {
      problems.push({
        path: `${WORLD_PROFILE_KEY}.fieldHistory`,
        message: `History change ${change.id} supersedes unknown id ${change.supersedesId}.`,
      });
    }
  }
  const profile: WorldProfile = {
    version: 1,
    definitionId,
    summary: text(row.summary, MAX_SUMMARY),
    values: readValues(row.values),
    collections: readCollections(row.collections),
    fieldMeta: readFieldMeta(row.fieldMeta),
    migrationHold: readMigrationHold(row.migrationHold),
    fieldHistory,
  };
  return { profile, problems, ok: problems.length === 0 };
}

function toJson(profile: WorldProfile): JsonObject {
  return JSON.parse(JSON.stringify(profile)) as JsonObject;
}

/** Replace only fields.worldProfile, keeping unknown keys on both fields and profile. */
export function withWorldProfile(fields: JsonObject, profile: WorldProfile): JsonObject {
  const known = toJson(profile);
  const previous = asRecord(fields[WORLD_PROFILE_KEY]);
  const merged: JsonObject = { ...known };
  const knownSet = new Set<string>(WORLD_PROFILE_KNOWN_KEYS);
  if (previous) {
    for (const key of Object.keys(previous)) {
      if (!knownSet.has(key) && !(key in known)) merged[key] = previous[key] as JsonValue;
    }
  }
  return { ...fields, [WORLD_PROFILE_KEY]: merged };
}

export function withoutWorldProfile(fields: JsonObject): JsonObject {
  if (!(WORLD_PROFILE_KEY in fields)) return fields;
  const next = { ...fields };
  delete next[WORLD_PROFILE_KEY];
  return next;
}

export function worldProfileIsEmpty(profile: WorldProfile): boolean {
  return JSON.stringify(profile) === JSON.stringify(emptyWorldProfile());
}

/** Problems that block writing a worldProfile object from a change package or save. */
export function worldProfileWriteProblems(value: unknown): WorldProfileProblem[] {
  if (value === undefined || value === null) return [];
  const row = asRecord(value);
  if (!row) return [{ path: WORLD_PROFILE_KEY, message: "World profile metadata is not an object." }];
  if (row.version !== undefined && row.version !== WORLD_PROFILE_VERSION) {
    return [{ path: `${WORLD_PROFILE_KEY}.version`, message: "This world profile version is not supported." }];
  }
  if (row.version === undefined) {
    return [{ path: `${WORLD_PROFILE_KEY}.version`, message: "World profile metadata needs version 1." }];
  }
  if (row.fieldHistory !== undefined && row.fieldHistory !== null && !Array.isArray(row.fieldHistory)) {
    return [{ path: `${WORLD_PROFILE_KEY}.fieldHistory`, message: "World profile fieldHistory must be an array." }];
  }
  if (Array.isArray(row.fieldHistory) && row.fieldHistory.length > MAX_FIELD_HISTORY) {
    return [
      {
        path: `${WORLD_PROFILE_KEY}.fieldHistory`,
        message: `World profile fieldHistory is limited to ${MAX_FIELD_HISTORY} entries.`,
      },
    ];
  }
  return readWorldProfile({ [WORLD_PROFILE_KEY]: value }).problems;
}

/** True when worldProfile is present on a type that must not carry it. */
export function worldProfileOnUnsupportedTypeProblems(
  type: RecordType,
  fields: Readonly<Record<string, unknown>>,
): WorldProfileProblem[] {
  if (!(WORLD_PROFILE_KEY in fields) || fields[WORLD_PROFILE_KEY] === undefined || fields[WORLD_PROFILE_KEY] === null) {
    return [];
  }
  if (isWorldProfileRecordType(type)) return [];
  return [
    {
      path: WORLD_PROFILE_KEY,
      message:
        type === "character_dossier"
          ? "Living World Profiles are not used on character dossiers; use characterDevelopment instead."
          : "Living World Profiles are only allowed on non-character World reference records.",
    },
  ];
}

export function formatWorldProfileFieldValue(value: WorldProfileFieldValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  if ("recordId" in value && typeof (value as WorldProfileRecordRef).recordId === "string" && !("freeText" in value)) {
    return (value as WorldProfileRecordRef).recordId;
  }
  const date = value as WorldProfileCalendarDate;
  const parts: string[] = [];
  if (date.freeText?.trim()) parts.push(date.freeText.trim());
  if (date.year != null) parts.push(String(date.year));
  if (date.monthPosition != null) parts.push(`m${date.monthPosition}`);
  if (date.day != null) parts.push(`d${date.day}`);
  if (date.eraId) parts.push(date.eraId);
  return parts.join(" ");
}

export { AUTHORITY_STATUSES };
