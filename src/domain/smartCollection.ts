import { isRecordType, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import { isManuscriptSceneStatus, type ManuscriptSceneStatus } from "@/writing/manuscriptStructure";

export const SMART_COLLECTION_SCOPES = ["manuscript", "world"] as const;
export type SmartCollectionScope = (typeof SMART_COLLECTION_SCOPES)[number];

export function isSmartCollectionScope(value: unknown): value is SmartCollectionScope {
  return typeof value === "string" && (SMART_COLLECTION_SCOPES as readonly string[]).includes(value);
}

/** Composable read-only predicates for a smart collection. */
export interface SmartCollectionFilter {
  types?: RecordType[];
  draftId?: string | null;
  authorityStatuses?: AuthorityStatus[];
  protected?: boolean | null;
  pov?: string;
  sceneStatuses?: ManuscriptSceneStatus[];
  wordMin?: number;
  wordMax?: number;
  hasUnresolvedContinuity?: boolean;
  linkedRecordId?: string;
  query?: string;
}

export interface SmartCollectionRecordLike {
  id: string;
  type: string;
  title: string;
  body?: string;
  draftId?: string | null;
  authorityStatus: string;
  protected: boolean;
  words?: number;
  pov?: string;
  sceneStatus?: string;
  continuityOpenCount?: number;
  linkedRecordIds?: readonly string[];
}

export function parseSmartCollectionFilter(raw: unknown): SmartCollectionFilter {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const filter: SmartCollectionFilter = {};
  if (Array.isArray(obj.types)) {
    filter.types = obj.types.filter((t): t is RecordType => isRecordType(t));
  }
  if (obj.draftId === null) filter.draftId = null;
  else if (typeof obj.draftId === "string") filter.draftId = obj.draftId;
  if (Array.isArray(obj.authorityStatuses)) {
    filter.authorityStatuses = obj.authorityStatuses.filter((s): s is AuthorityStatus => isAuthorityStatus(s));
  }
  if (typeof obj.protected === "boolean") filter.protected = obj.protected;
  else if (obj.protected === null) filter.protected = null;
  if (typeof obj.pov === "string") filter.pov = obj.pov.trim().slice(0, 200);
  if (Array.isArray(obj.sceneStatuses)) {
    filter.sceneStatuses = obj.sceneStatuses.filter((s): s is ManuscriptSceneStatus => isManuscriptSceneStatus(s));
  }
  if (typeof obj.wordMin === "number" && Number.isFinite(obj.wordMin)) filter.wordMin = Math.max(0, Math.floor(obj.wordMin));
  if (typeof obj.wordMax === "number" && Number.isFinite(obj.wordMax)) filter.wordMax = Math.max(0, Math.floor(obj.wordMax));
  if (typeof obj.hasUnresolvedContinuity === "boolean") filter.hasUnresolvedContinuity = obj.hasUnresolvedContinuity;
  if (typeof obj.linkedRecordId === "string") filter.linkedRecordId = obj.linkedRecordId;
  if (typeof obj.query === "string") filter.query = obj.query.trim().slice(0, 200);
  return filter;
}

export function matchesSmartCollection(
  record: SmartCollectionRecordLike,
  filter: SmartCollectionFilter,
): boolean {
  if (filter.types?.length && !filter.types.includes(record.type as RecordType)) return false;
  if (filter.draftId !== undefined) {
    if (filter.draftId === null && record.draftId) return false;
    if (filter.draftId !== null && record.draftId !== filter.draftId) return false;
  }
  if (filter.authorityStatuses?.length && !filter.authorityStatuses.includes(record.authorityStatus as AuthorityStatus)) {
    return false;
  }
  if (typeof filter.protected === "boolean" && record.protected !== filter.protected) return false;
  if (filter.pov && (record.pov ?? "").trim().toLocaleLowerCase() !== filter.pov.toLocaleLowerCase()) return false;
  if (filter.sceneStatuses?.length) {
    const status = record.sceneStatus ?? "";
    if (!filter.sceneStatuses.includes(status as ManuscriptSceneStatus)) return false;
  }
  const words = record.words ?? 0;
  if (filter.wordMin !== undefined && words < filter.wordMin) return false;
  if (filter.wordMax !== undefined && words > filter.wordMax) return false;
  if (filter.hasUnresolvedContinuity && !(record.continuityOpenCount && record.continuityOpenCount > 0)) return false;
  if (filter.linkedRecordId) {
    const links = record.linkedRecordIds ?? [];
    if (!links.includes(filter.linkedRecordId)) return false;
  }
  if (filter.query) {
    const needle = filter.query.toLocaleLowerCase();
    const hay = `${record.title}\n${record.body ?? ""}\n${record.pov ?? ""}`.toLocaleLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}
