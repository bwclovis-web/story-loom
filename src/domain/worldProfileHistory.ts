/**
 * Dated world-field chronology for Living World Profiles.
 * Reuses NarrativePoint + OrderEdge placement rules from character development.
 * Domain-only: no DB imports.
 */

import type { NarrativePoint } from "@/domain/characterDevelopment";
import {
  formatWorldProfileFieldValue,
  type WorldFieldHistoryChange,
  type WorldProfile,
  type WorldProfileFieldValue,
} from "@/domain/worldProfile";
import { orderRelation, type OrderEdge } from "@/world/storyOrder";

export type WorldHistoryBookOrder = ReadonlyArray<{ projectId: string; narrativeIndex: number }>;

export type ResolvedWorldField =
  | { presence: "unknown"; changeId?: string }
  | { presence: "set"; value: WorldProfileFieldValue; changeId: string; formatted: string };

export interface WorldFieldConflict {
  fieldPath: string;
  changeIds: string[];
  reason: string;
}

export interface ResolvedWorldFields {
  fields: Record<string, ResolvedWorldField>;
  unplacedChangeIds: string[];
  conflicts: WorldFieldConflict[];
  supersededChangeIds: string[];
}

export interface WorldFieldComparisonDiff {
  fieldPath: string;
  from: ResolvedWorldField;
  to: ResolvedWorldField;
  kind: "unchanged" | "added" | "cleared" | "changed" | "became_unknown" | "conflict";
}

export interface WorldFieldComparison {
  from: ResolvedWorldFields;
  to: ResolvedWorldFields;
  diffs: WorldFieldComparisonDiff[];
}

type Placement = "at_or_before" | "after" | "unresolved";

function bookIndex(books: WorldHistoryBookOrder, projectId: string | null): number | null {
  if (!projectId) return null;
  const book = books.find((item) => item.projectId === projectId);
  return book?.narrativeIndex ?? null;
}

function changeIsSuperseded(profile: WorldProfile, changeId: string): boolean {
  return profile.fieldHistory.some(
    (change) => change.supersedesId === changeId && change.approval === "approved" && !change.planned,
  );
}

function compareChanges(
  books: WorldHistoryBookOrder,
  left: WorldFieldHistoryChange,
  right: WorldFieldHistoryChange,
  edges: readonly OrderEdge[],
): Placement {
  if (left.storyEventId && right.storyEventId && left.storyEventId !== right.storyEventId) {
    const relation = orderRelation(edges, left.storyEventId, right.storyEventId);
    if (relation === "before") return "at_or_before";
    if (relation === "after") return "after";
  }
  const leftBook = bookIndex(books, left.bookProjectId);
  const rightBook = bookIndex(books, right.bookProjectId);
  if (leftBook !== null && rightBook !== null && leftBook !== rightBook) {
    return leftBook < rightBook ? "at_or_before" : "after";
  }
  if (left.sequence !== null && right.sequence !== null && left.sequence !== right.sequence) {
    return left.sequence < right.sequence ? "at_or_before" : "after";
  }
  if (left.storyEventId && right.storyEventId && left.storyEventId === right.storyEventId) return "at_or_before";
  return "unresolved";
}

function placeAgainstPoint(
  books: WorldHistoryBookOrder,
  change: WorldFieldHistoryChange,
  point: NarrativePoint,
  edges: readonly OrderEdge[],
): Placement {
  if (change.sceneRecordId && point.sceneRecordId) {
    if (change.sceneRecordId === point.sceneRecordId) return "at_or_before";
  }
  if (change.chapterRecordId && point.chapterRecordId) {
    if (change.chapterRecordId === point.chapterRecordId && !change.sceneRecordId) return "at_or_before";
  }
  if (change.storyEventId && point.storyEventId) {
    if (change.storyEventId === point.storyEventId) return "at_or_before";
    const relation = orderRelation(edges, change.storyEventId, point.storyEventId);
    if (relation === "before") return "at_or_before";
    if (relation === "after") return "after";
  }
  const changeBook = bookIndex(books, change.bookProjectId);
  const pointBook = bookIndex(books, point.bookProjectId);
  if (changeBook !== null && pointBook !== null && changeBook !== pointBook) {
    return changeBook < pointBook ? "at_or_before" : "after";
  }
  if (
    change.bookProjectId &&
    point.bookProjectId &&
    change.bookProjectId !== point.bookProjectId &&
    (changeBook === null || pointBook === null)
  ) {
    return "unresolved";
  }
  if (change.sequence !== null && point.sequence !== null) {
    return change.sequence <= point.sequence ? "at_or_before" : "after";
  }
  if (!change.storyEventId && !point.storyEventId && change.sequence === null && point.sequence === null) {
    if (!change.bookProjectId || change.bookProjectId === point.bookProjectId) return "at_or_before";
  }
  if (change.storyEventId && point.storyEventId) return "unresolved";
  if (change.sequence !== null && point.sequence === null && (!point.storyEventId || !change.storyEventId)) {
    return "unresolved";
  }
  if (!change.bookProjectId || change.bookProjectId === point.bookProjectId) {
    if (change.sequence === null && point.sequence === null && !change.storyEventId) return "at_or_before";
  }
  return "unresolved";
}

/** Filter book-local history when resolving from another book in the series. */
export function visibleWorldFieldHistory(
  profile: WorldProfile,
  viewingProjectId: string | null,
): WorldFieldHistoryChange[] {
  return profile.fieldHistory.filter((change) => {
    if (change.worldScope === "series") return true;
    if (!viewingProjectId) return false;
    return change.bookProjectId === viewingProjectId;
  });
}

/**
 * Canonical world field values at a narrative point.
 * Only approved, unplanned, non-superseded dated changes apply.
 * Undated current values never fill historical gaps — absence stays unknown.
 */
export function resolveWorldFieldsAtPoint(
  profile: WorldProfile,
  point: NarrativePoint,
  edges: readonly OrderEdge[] = [],
  options: {
    books?: WorldHistoryBookOrder;
    viewingProjectId?: string | null;
    fieldPaths?: readonly string[];
  } = {},
): ResolvedWorldFields {
  const books = options.books ?? [];
  const viewingProjectId = options.viewingProjectId ?? point.bookProjectId;
  const history = visibleWorldFieldHistory(profile, viewingProjectId ?? null);
  const supersededChangeIds = history
    .filter((change) => change.approval === "superseded" || changeIsSuperseded({ ...profile, fieldHistory: history }, change.id))
    .map((change) => change.id);
  const boundary = point.boundary ?? "at_point";
  const fields: Record<string, ResolvedWorldField> = {};
  const conflicts: WorldFieldConflict[] = [];

  if (boundary === "baseline") {
    return { fields, unplacedChangeIds: [], conflicts, supersededChangeIds };
  }

  const candidates = history.filter(
    (change) => change.approval === "approved" && !change.planned && !changeIsSuperseded({ ...profile, fieldHistory: history }, change.id),
  );
  const unplacedChangeIds: string[] = [];
  const included: WorldFieldHistoryChange[] = [];

  for (const change of candidates) {
    if (boundary === "book_start") {
      if (change.bookProjectId === point.bookProjectId) continue;
      const changeBook = bookIndex(books, change.bookProjectId);
      const pointBook = bookIndex(books, point.bookProjectId);
      if (changeBook !== null && pointBook !== null && changeBook < pointBook) {
        included.push(change);
      } else if (change.bookProjectId && point.bookProjectId && change.bookProjectId !== point.bookProjectId) {
        if (changeBook === null || pointBook === null) unplacedChangeIds.push(change.id);
      }
      continue;
    }
    if (boundary === "book_end" && point.bookProjectId) {
      const changeBook = bookIndex(books, change.bookProjectId);
      const pointBook = bookIndex(books, point.bookProjectId);
      if (change.bookProjectId === point.bookProjectId) {
        included.push(change);
        continue;
      }
      if (changeBook !== null && pointBook !== null) {
        if (changeBook <= pointBook) included.push(change);
        continue;
      }
      if (change.bookProjectId && change.bookProjectId !== point.bookProjectId) {
        unplacedChangeIds.push(change.id);
      }
      continue;
    }
    const placement = placeAgainstPoint(books, change, point, edges);
    if (placement === "unresolved") unplacedChangeIds.push(change.id);
    else if (placement === "at_or_before") included.push(change);
  }

  const paths = new Set<string>(
    options.fieldPaths?.length ? options.fieldPaths : included.map((change) => change.fieldPath),
  );
  for (const fieldPath of paths) {
    const group = included.filter((change) => change.fieldPath === fieldPath);
    if (!group.length) {
      fields[fieldPath] = { presence: "unknown" };
      continue;
    }
    let latest = group[0]!;
    const tied: string[] = [];
    for (const change of group.slice(1)) {
      const placement = compareChanges(books, latest, change, edges);
      if (placement === "at_or_before") latest = change;
      else if (placement === "unresolved") {
        tied.push(change.id);
        if (group.indexOf(change) > group.indexOf(latest)) latest = change;
      }
    }
    if (tied.length) {
      conflicts.push({
        fieldPath,
        changeIds: [latest.id, ...tied],
        reason: "Two or more approved changes could not be ordered relative to each other.",
      });
    }
    fields[fieldPath] =
      latest.presence === "unknown"
        ? { presence: "unknown", changeId: latest.id }
        : {
            presence: "set",
            value: latest.value,
            changeId: latest.id,
            formatted: formatWorldProfileFieldValue(latest.value),
          };
  }

  return { fields, unplacedChangeIds, conflicts, supersededChangeIds };
}

export function compareWorldFieldsAtPoints(
  profile: WorldProfile,
  fromPoint: NarrativePoint,
  toPoint: NarrativePoint,
  edges: readonly OrderEdge[] = [],
  options: {
    books?: WorldHistoryBookOrder;
    viewingProjectId?: string | null;
    fieldPaths?: readonly string[];
  } = {},
): WorldFieldComparison {
  const pathSet = new Set<string>(options.fieldPaths ?? []);
  if (!pathSet.size) {
    for (const change of profile.fieldHistory) pathSet.add(change.fieldPath);
  }
  const fieldPaths = [...pathSet];
  const resolveOpts = { ...options, fieldPaths };
  const from = resolveWorldFieldsAtPoint(profile, fromPoint, edges, resolveOpts);
  const to = resolveWorldFieldsAtPoint(profile, toPoint, edges, resolveOpts);
  const diffs: WorldFieldComparisonDiff[] = fieldPaths.map((fieldPath) => {
    const left = from.fields[fieldPath] ?? { presence: "unknown" as const };
    const right = to.fields[fieldPath] ?? { presence: "unknown" as const };
    const conflicted =
      to.conflicts.some((item) => item.fieldPath === fieldPath) ||
      from.conflicts.some((item) => item.fieldPath === fieldPath);
    if (conflicted) return { fieldPath, from: left, to: right, kind: "conflict" as const };
    if (left.presence === right.presence) {
      if (left.presence === "unknown" && right.presence === "unknown") {
        return { fieldPath, from: left, to: right, kind: "unchanged" as const };
      }
      if (
        left.presence === "set" &&
        right.presence === "set" &&
        formatWorldProfileFieldValue(left.value) === formatWorldProfileFieldValue(right.value)
      ) {
        return { fieldPath, from: left, to: right, kind: "unchanged" as const };
      }
    }
    if (left.presence === "unknown" && right.presence === "set") {
      return { fieldPath, from: left, to: right, kind: "added" as const };
    }
    if (left.presence === "set" && right.presence === "unknown") {
      return { fieldPath, from: left, to: right, kind: "became_unknown" as const };
    }
    return { fieldPath, from: left, to: right, kind: "changed" as const };
  });
  return { from, to, diffs };
}

/**
 * Mark prior change superseded and append a replacement linked by supersedesId.
 * Nothing is deleted; Revisions recover prior fields.
 */
export function supersedeWorldFieldChange(
  profile: WorldProfile,
  previousId: string,
  replacement: Omit<WorldFieldHistoryChange, "id" | "supersedesId"> & { id?: string },
  idFor: (prefix: string) => string,
): { ok: true; profile: WorldProfile } | { ok: false; message: string } {
  const previous = profile.fieldHistory.find((change) => change.id === previousId);
  if (!previous) return { ok: false, message: "The world field change to correct was not found." };
  const nextId = replacement.id ?? idFor("wfh");
  const corrected: WorldFieldHistoryChange = {
    ...previous,
    approval: "superseded",
    correctedAt: new Date().toISOString(),
    correctionNote: replacement.correctionNote || previous.correctionNote || "Corrected by a later field change.",
  };
  const nextChange: WorldFieldHistoryChange = {
    ...replacement,
    id: nextId,
    supersedesId: previousId,
    correctionNote: replacement.correctionNote || `Corrects ${previousId}`,
    correctedAt: null,
    chapterRecordId: replacement.chapterRecordId ?? previous.chapterRecordId,
    fieldPath: replacement.fieldPath || previous.fieldPath,
    storage: replacement.storage || previous.storage,
    definitionId: replacement.definitionId ?? previous.definitionId,
  };
  return {
    ok: true,
    profile: {
      ...profile,
      fieldHistory: [
        ...profile.fieldHistory.map((change) => (change.id === previousId ? corrected : change)),
        nextChange,
      ],
    },
  };
}

/** Append a new dated change without superseding. */
export function appendWorldFieldChange(
  profile: WorldProfile,
  change: WorldFieldHistoryChange,
): WorldProfile {
  return {
    ...profile,
    fieldHistory: [...profile.fieldHistory, change],
  };
}

/** Redact history entries that must not leave the drafting export. */
export function redactWorldFieldHistoryForExport(
  profile: WorldProfile,
  point: NarrativePoint | null,
  edges: readonly OrderEdge[] = [],
  options: { books?: WorldHistoryBookOrder; viewingProjectId?: string | null } = {},
): WorldProfile {
  if (!profile.fieldHistory.length) return profile;
  if (!point) {
    return {
      ...profile,
      fieldHistory: profile.fieldHistory.filter(
        (change) => change.approval === "approved" && !change.planned,
      ),
    };
  }
  const books = options.books ?? [];
  const viewingProjectId = options.viewingProjectId ?? point.bookProjectId;
  const kept: WorldFieldHistoryChange[] = [];
  for (const change of visibleWorldFieldHistory(profile, viewingProjectId ?? null)) {
    if (change.approval !== "approved" || change.planned) continue;
    if (changeIsSuperseded(profile, change.id)) continue;
    if ((point.boundary ?? "at_point") === "baseline") continue;
    const placement = placeAgainstPoint(books, change, point, edges);
    if (placement === "at_or_before") kept.push(change);
  }
  return { ...profile, fieldHistory: kept };
}
