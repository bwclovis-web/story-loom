/**
 * Point-scoped Living World Profile context for AI drafting and export.
 * Reuses W5C resolveWorldFieldsAtPoint / redactWorldFieldHistoryForExport.
 * Domain-only: no DB imports.
 */

import type { NarrativePoint } from "@/domain/characterDevelopment";
import type { WritingContextMode, WritingContextPolicy } from "@/domain/characterWritingContext";
import { writingContextPolicy } from "@/domain/characterWritingContext";
import type { JsonObject } from "@/domain/json";
import {
  formatWorldProfileFieldValue,
  isWorldProfileRecordType,
  readWorldProfile,
  WORLD_PROFILE_KEY,
  withWorldProfile,
  worldFieldIsApproved,
  type WorldFieldHistoryChange,
  type WorldProfile,
  type WorldProfileFieldValue,
} from "@/domain/worldProfile";
import {
  redactWorldFieldHistoryForExport,
  resolveWorldFieldsAtPoint,
  visibleWorldFieldHistory,
  type WorldHistoryBookOrder,
} from "@/domain/worldProfileHistory";
import { WORLD_HEADING_MAP, WORLD_MARKDOWN_ARCHIVE_KEY } from "@/domain/worldProfileUpgrade";
import { listSections, statusTagOf } from "@/writing/sections";
import type { OrderEdge } from "@/world/storyOrder";
import { orderGraphHasCycle } from "@/world/storyOrder";

const HEADING_TO_FIELD = new Map(
  WORLD_HEADING_MAP.map((row) => [row.heading.trim().toLowerCase(), row.fieldKey]),
);

const FIELD_KEY_LABELS = new Map(
  WORLD_HEADING_MAP.map((row) => [row.fieldKey, row.heading]),
);

export type WorldStoryPointStatus = "anchored" | "unanchored";

export interface WorldContextOmission {
  label: string;
  reason: string;
  fieldPath?: string;
  changeId?: string;
}

export interface WorldContextFact {
  fieldPath: string;
  formatted: string;
  changeId: string;
  storyEventId: string | null;
  chapterRecordId: string | null;
  sceneRecordId: string | null;
  calendarLabel: string | null;
  evidenceHeading: string | null;
  evidenceRevision: number | null;
}

export interface WorldContextSliceMeta {
  mode: WritingContextMode;
  storyPointStatus: WorldStoryPointStatus;
  factCount: number;
  omittedPlanned: number;
  omittedConflicts: number;
  omittedUnplaced: number;
  omittedBookLocal: number;
  omissions: WorldContextOmission[];
}

export interface RenderWorldContextSliceInput {
  title: string;
  recordId: string;
  body?: string;
  fields: Readonly<Record<string, unknown>>;
  mode?: WritingContextMode;
  allowFuturePlans?: boolean;
  point?: NarrativePoint | null;
  edges?: readonly OrderEdge[];
  books?: WorldHistoryBookOrder;
  viewingProjectId?: string | null;
  /** Sibling-book home label when the record is series-shared. */
  homeLabel?: string | null;
}

function unsettledStatusTag(tag: string | null): boolean {
  if (!tag) return false;
  const upper = tag.toUpperCase();
  return (
    upper.includes("PROPOSED") ||
    upper.includes("WORKING") ||
    upper.includes("OPEN") ||
    upper.includes("SELECTED") ||
    upper.includes("DRAFT")
  );
}

function pointIsAnchored(point: NarrativePoint | null | undefined): boolean {
  if (!point) return false;
  return Boolean(
    point.storyEventId ||
      point.chapterRecordId ||
      point.sceneRecordId ||
      point.sequence !== null ||
      (point.boundary && point.boundary !== "at_point"),
  );
}

function fieldLabel(fieldPath: string): string {
  if (fieldPath === "summary") return "Summary";
  const key = fieldPath.startsWith("values.")
    ? fieldPath.slice("values.".length)
    : fieldPath.startsWith("fields.")
      ? fieldPath.slice("fields.".length)
      : fieldPath;
  return FIELD_KEY_LABELS.get(key) ?? key;
}

function collectFieldPaths(profile: WorldProfile, fields: Readonly<Record<string, unknown>>): string[] {
  const paths = new Set<string>();
  for (const change of profile.fieldHistory) paths.add(change.fieldPath);
  if (profile.summary.trim()) paths.add("summary");
  for (const key of Object.keys(profile.values)) paths.add(`values.${key}`);
  for (const key of Object.keys(fields)) {
    if (key === WORLD_PROFILE_KEY || key === WORLD_MARKDOWN_ARCHIVE_KEY) continue;
    if (typeof fields[key] === "string" || typeof fields[key] === "number" || typeof fields[key] === "boolean") {
      paths.add(`fields.${key}`);
    }
  }
  return [...paths];
}

function currentUndatedValue(
  profile: WorldProfile,
  fields: Readonly<Record<string, unknown>>,
  fieldPath: string,
): WorldProfileFieldValue | null {
  if (fieldPath === "summary") return profile.summary.trim() ? profile.summary : null;
  if (fieldPath.startsWith("values.")) {
    const key = fieldPath.slice("values.".length);
    const value = profile.values[key];
    return value === undefined || value === null || value === "" ? null : value;
  }
  if (fieldPath.startsWith("fields.")) {
    const key = fieldPath.slice("fields.".length);
    const raw = fields[key];
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
    return null;
  }
  return null;
}

/**
 * Strip unsettled status-tagged sections and headings that already appear as
 * structured profile fields. Used by W7A drafting context and W7C point-scoped
 * world-bible body rendering.
 */
export function stripUnsettledAndOverlappingBody(
  body: string,
  representedPaths: ReadonlySet<string>,
): string {
  const sections = listSections(body);
  if (!sections.length) {
    return body.trim();
  }
  const kept: string[] = [];
  let cursor = 0;
  for (const section of sections) {
    if (section.start > cursor) {
      const preamble = body.slice(cursor, section.start).trim();
      if (preamble) kept.push(preamble);
    }
    const tag = section.statusTag ?? statusTagOf(section.title);
    const clean = section.title
      .replace(/\[[^\]]+\]/g, "")
      .replace(/[—–-]\s*\w+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const mappedKey = HEADING_TO_FIELD.get(clean);
    const overlaps =
      representedPaths.has(`values.${clean}`) ||
      representedPaths.has(`fields.${clean}`) ||
      (mappedKey != null &&
        (representedPaths.has(`values.${mappedKey}`) ||
          representedPaths.has(`fields.${mappedKey}`) ||
          (mappedKey === "summary" && representedPaths.has("summary")))) ||
      (clean === "summary" && representedPaths.has("summary")) ||
      (clean === "overview" && representedPaths.has("summary")) ||
      (clean === "access" && representedPaths.has("values.access")) ||
      (clean === "climate" && representedPaths.has("fields.climate"));
    if (!unsettledStatusTag(tag) && !overlaps) {
      kept.push(body.slice(section.start, section.end).trim());
    }
    cursor = section.end;
  }
  if (cursor < body.length) {
    const tail = body.slice(cursor).trim();
    if (tail) kept.push(tail);
  }
  return kept.join("\n\n").trim();
}

function evidenceFromChange(change: WorldFieldHistoryChange | undefined): {
  evidenceHeading: string | null;
  evidenceRevision: number | null;
} {
  if (!change) return { evidenceHeading: null, evidenceRevision: null };
  const refs = change.provenance.sourceRefs ?? [];
  const first = refs[0];
  return {
    evidenceHeading: first?.heading?.trim() || change.calendarLabel || null,
    evidenceRevision: first?.revisionNumber ?? null,
  };
}

/**
 * Render a compact, point-scoped world reference for drafting / editorial AI.
 * Never dumps raw fields JSON, archives, or planned/future history.
 */
export function renderWorldContextSlice(input: RenderWorldContextSliceInput): {
  text: string;
  meta: WorldContextSliceMeta;
} {
  const mode = input.mode ?? "editorial";
  const policy = writingContextPolicy(mode, input.allowFuturePlans === true);
  const point =
    input.point ??
    ({
      bookProjectId: input.viewingProjectId ?? null,
      storyEventId: null,
      sequence: null,
    } satisfies NarrativePoint);
  const edges = input.edges ?? [];
  const books = input.books ?? [];
  const viewingProjectId = input.viewingProjectId ?? point.bookProjectId ?? null;
  const anchored = pointIsAnchored(point);
  const storyPointStatus: WorldStoryPointStatus = anchored ? "anchored" : "unanchored";

  const read = readWorldProfile(input.fields);
  const profile = read.ok ? read.profile : null;
  const omissions: WorldContextOmission[] = [];
  const facts: WorldContextFact[] = [];
  let omittedPlanned = 0;
  let omittedConflicts = 0;
  let omittedUnplaced = 0;
  let omittedBookLocal = 0;

  const lines: string[] = [`# ${input.title}`];
  lines.push(
    "",
    "World facts below are objective setting state at this story point. They are distinct from what any viewpoint character has learned.",
  );
  if (input.homeLabel) {
    lines.push(`Series-shared reference (home book: ${input.homeLabel}). Edit in the home book.`);
  }
  if (storyPointStatus === "unanchored") {
    lines.push(
      "Story point status: unanchored. Only clearly prior-book approved history is treated as settled; event-dated sibling-book changes stay unresolved until the scene is linked.",
    );
  }

  if (profile && profile.fieldHistory.length) {
    const history = visibleWorldFieldHistory(profile, viewingProjectId);
    const invisibleLocal = profile.fieldHistory.filter(
      (change) => !history.some((item) => item.id === change.id) && change.worldScope === "book",
    );
    omittedBookLocal += invisibleLocal.length;
    for (const change of invisibleLocal) {
      omissions.push({
        label: fieldLabel(change.fieldPath),
        reason: "Book-local world change from another book is not visible here.",
        fieldPath: change.fieldPath,
        changeId: change.id,
      });
    }
    omittedPlanned += history.filter((change) => change.planned || change.approval !== "approved").length;
    for (const change of history.filter((item) => item.planned || item.approval !== "approved")) {
      omissions.push({
        label: fieldLabel(change.fieldPath),
        reason: change.planned
          ? "Planned future world change omitted from drafting context."
          : "Unapproved world change omitted from drafting context.",
        fieldPath: change.fieldPath,
        changeId: change.id,
      });
    }

    const fieldPaths = collectFieldPaths(profile, input.fields);
    const eventIds = [
      ...new Set(
        history
          .map((change) => change.storyEventId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const cycle = orderGraphHasCycle(eventIds, edges);

    const resolved = resolveWorldFieldsAtPoint(profile, point, edges, {
      books,
      viewingProjectId,
      fieldPaths,
    });

    for (const conflict of resolved.conflicts) {
      omittedConflicts += 1;
      omissions.push({
        label: fieldLabel(conflict.fieldPath),
        reason: `Ambiguous chronology: ${conflict.reason} (${conflict.changeIds.join(", ")})`,
        fieldPath: conflict.fieldPath,
        changeId: conflict.changeIds[0],
      });
    }
    if (cycle) {
      omissions.push({
        label: "Story event order",
        reason: "Story-event order has a cycle; conflicted world fields are withheld as settled truth.",
      });
    }

    for (const changeId of resolved.unplacedChangeIds) {
      omittedUnplaced += 1;
      const change = history.find((item) => item.id === changeId);
      omissions.push({
        label: change ? fieldLabel(change.fieldPath) : changeId,
        reason:
          storyPointStatus === "unanchored"
            ? "World change could not be ordered without a story-point anchor."
            : "World change could not be ordered relative to this story point.",
        fieldPath: change?.fieldPath,
        changeId,
      });
    }

    const conflicted = new Set(resolved.conflicts.map((item) => item.fieldPath));
    const settledLines: string[] = [];
    const unknownLines: string[] = [];
    const undatedLines: string[] = [];

    for (const fieldPath of fieldPaths) {
      if (conflicted.has(fieldPath) || cycle) continue;
      const resolvedField = resolved.fields[fieldPath] ?? { presence: "unknown" as const };
      if (resolvedField.presence === "set") {
        const change = history.find((item) => item.id === resolvedField.changeId);
        const evidence = evidenceFromChange(change);
        facts.push({
          fieldPath,
          formatted: resolvedField.formatted,
          changeId: resolvedField.changeId,
          storyEventId: change?.storyEventId ?? null,
          chapterRecordId: change?.chapterRecordId ?? null,
          sceneRecordId: change?.sceneRecordId ?? null,
          calendarLabel: change?.calendarLabel ?? null,
          evidenceHeading: evidence.evidenceHeading,
          evidenceRevision: evidence.evidenceRevision,
        });
        const anchorBits = [
          `change ${resolvedField.changeId}`,
          `record ${input.recordId}`,
          input.homeLabel ? `home ${input.homeLabel}` : null,
          change?.storyEventId ? `event ${change.storyEventId}` : null,
          change?.sceneRecordId ? `scene ${change.sceneRecordId}` : null,
          change?.chapterRecordId ? `chapter ${change.chapterRecordId}` : null,
          evidence.evidenceHeading ? `evidence ${evidence.evidenceHeading}` : null,
          evidence.evidenceRevision != null ? `rev ${evidence.evidenceRevision}` : null,
        ].filter(Boolean);
        settledLines.push(`- ${fieldLabel(fieldPath)}: ${resolvedField.formatted} (${anchorBits.join("; ")})`);
        continue;
      }

      const undated = currentUndatedValue(profile, input.fields, fieldPath);
      if (undated == null) {
        unknownLines.push(`- ${fieldLabel(fieldPath)}: unknown at this story point`);
        continue;
      }
      const approved = worldFieldIsApproved(profile, fieldPath);
      if (policy.mode === "drafting" || anchored) {
        unknownLines.push(`- ${fieldLabel(fieldPath)}: unknown at this story point (undated current value not applied)`);
        omissions.push({
          label: fieldLabel(fieldPath),
          reason: "Undated current world value does not fill earlier story time.",
          fieldPath,
        });
      } else if (approved) {
        undatedLines.push(
          `- ${fieldLabel(fieldPath)}: ${formatWorldProfileFieldValue(undated)} (undated current author surface — not story-point verified)`,
        );
      } else {
        omissions.push({
          label: fieldLabel(fieldPath),
          reason: "Unapproved undated world value omitted.",
          fieldPath,
        });
      }
    }

    if (settledLines.length) {
      lines.push("", "## Settled world facts at story point", ...settledLines);
    }
    if (unknownLines.length && policy.mode === "drafting") {
      lines.push("", "## Unknown at story point", ...unknownLines.slice(0, 24));
    }
    if (undatedLines.length) {
      lines.push("", "## Undated current author surface", ...undatedLines);
    }
  } else if (profile && !profile.fieldHistory.length) {
    // No chronology yet: only approved undated surface outside drafting/anchored modes.
    const undatedLines: string[] = [];
    for (const fieldPath of collectFieldPaths(profile, input.fields)) {
      const undated = currentUndatedValue(profile, input.fields, fieldPath);
      if (undated == null) continue;
      if (policy.mode === "drafting" || anchored) {
        omissions.push({
          label: fieldLabel(fieldPath),
          reason: "Undated current world value does not fill earlier story time.",
          fieldPath,
        });
        continue;
      }
      if (worldFieldIsApproved(profile, fieldPath) || fieldPath.startsWith("fields.")) {
        undatedLines.push(
          `- ${fieldLabel(fieldPath)}: ${formatWorldProfileFieldValue(undated)} (undated current author surface — not story-point verified)`,
        );
      }
    }
    if (undatedLines.length) lines.push("", "## Undated current author surface", ...undatedLines);
  }

  if (input.body?.trim()) {
    const represented = new Set(facts.map((fact) => fact.fieldPath));
    // Also treat current profile values / flat fields as represented so Markdown
    // headings for the same keys (e.g. Population estimate) do not duplicate.
    if (profile) {
      for (const path of collectFieldPaths(profile, input.fields)) represented.add(path);
    }
    const supplement =
      policy.mode === "drafting"
        ? stripUnsettledAndOverlappingBody(input.body, represented)
        : input.body.trim();
    if (supplement) {
      lines.push(
        "",
        "## Legacy prose (uncertain chronology)",
        "Undated legacy background with uncertain chronology — do not assume it precedes or follows unlinked events.",
        supplement,
      );
    }
  }

  if (omissions.length && policy.mode === "drafting") {
    lines.push(
      "",
      `## Context notes (${omissions.length} omission${omissions.length === 1 ? "" : "s"})`,
      ...omissions.slice(0, 12).map((item) => `- ${item.label}: ${item.reason}`),
    );
  }

  return {
    text: lines.join("\n"),
    meta: {
      mode: policy.mode,
      storyPointStatus,
      factCount: facts.length,
      omittedPlanned,
      omittedConflicts,
      omittedUnplaced,
      omittedBookLocal,
      omissions,
    },
  };
}

/**
 * Strip spoilers / future / archive material from world fields for drafting
 * exports. Builds on redactWorldFieldHistoryForExport.
 */
export function redactWorldFieldsForExport(
  fields: JsonObject,
  policy: WritingContextPolicy,
  scope: {
    point?: NarrativePoint | null;
    edges?: readonly OrderEdge[];
    books?: WorldHistoryBookOrder;
    viewingProjectId?: string | null;
  } = {},
): JsonObject {
  const copy: JsonObject = { ...fields };
  delete copy[WORLD_MARKDOWN_ARCHIVE_KEY];

  if (!(WORLD_PROFILE_KEY in copy) || copy[WORLD_PROFILE_KEY] == null) return copy;
  const read = readWorldProfile(copy);
  if (!read.ok) return copy;

  const point = scope.point ?? null;
  const edges = scope.edges ?? [];
  const books = scope.books ?? [];
  const viewingProjectId = scope.viewingProjectId ?? point?.bookProjectId ?? null;

  let profile = redactWorldFieldHistoryForExport(read.profile, point, edges, {
    books,
    viewingProjectId,
  });

  const redactSpoilers = policy.mode === "drafting" || !policy.includePlanned;
  if (!redactSpoilers) {
    return withWorldProfile(copy, profile);
  }

  // Strip migration holds and source-ref excerpts from fieldMeta.
  profile = {
    ...profile,
    migrationHold: [],
    fieldMeta: Object.fromEntries(
      Object.entries(profile.fieldMeta).map(([path, meta]) => [
        path,
        {
          ...meta,
          provenance: {
            ...meta.provenance,
            sourceRefs: undefined,
            note: meta.provenance.note,
          },
        },
      ]),
    ),
  };

  if (point && (policy.mode === "drafting" || pointIsAnchored(point))) {
    const resolved = resolveWorldFieldsAtPoint(profile, point, edges, {
      books,
      viewingProjectId,
    });
    const nextValues: Record<string, WorldProfileFieldValue> = {};
    for (const [key, value] of Object.entries(profile.values)) {
      const path = `values.${key}`;
      const atPoint = resolved.fields[path];
      if (atPoint?.presence === "set") nextValues[key] = atPoint.value;
      else if (!profile.fieldHistory.some((change) => change.fieldPath === path)) {
        // No history for this path: drop undated current in drafting/anchored export.
      } else {
        // History exists but unresolved/unknown at point → omit current.
      }
    }
    profile = {
      ...profile,
      values: nextValues,
      summary:
        resolved.fields.summary?.presence === "set"
          ? formatWorldProfileFieldValue(resolved.fields.summary.value)
          : profile.fieldHistory.some((change) => change.fieldPath === "summary")
            ? ""
            : policy.mode === "drafting"
              ? ""
              : profile.summary,
    };
  } else {
    // Unanchored drafting: keep only approved values; clear draft/proposed.
    const nextValues: Record<string, WorldProfileFieldValue> = {};
    for (const [key, value] of Object.entries(profile.values)) {
      if (worldFieldIsApproved(profile, `values.${key}`)) nextValues[key] = value;
    }
    profile = {
      ...profile,
      values: nextValues,
      summary: worldFieldIsApproved(profile, "summary") ? profile.summary : "",
    };
  }

  // Drop draft/proposed collection items always in drafting redaction.
  profile = {
    ...profile,
    collections: Object.fromEntries(
      Object.entries(profile.collections).map(([key, items]) => [
        key,
        items.filter((item) => item.approval === "approved"),
      ]),
    ),
  };

  return withWorldProfile(copy, profile);
}

export function worldReferenceNeedsPointScopedRender(type: string, fields: Readonly<Record<string, unknown>>): boolean {
  if (!isWorldProfileRecordType(type)) return false;
  if (WORLD_PROFILE_KEY in fields && fields[WORLD_PROFILE_KEY] != null) return true;
  if (WORLD_MARKDOWN_ARCHIVE_KEY in fields && fields[WORLD_MARKDOWN_ARCHIVE_KEY] != null) return true;
  return true;
}

export { writingContextPolicy };
