import type { JsonObject } from "@/domain/json";
import type { RecordView } from "@/domain/records";
import { isLinkableReferenceType, isRecordType } from "@/domain/recordTypes";
import type { EstablishedFactView } from "@/server/services/establishedFactService";
import type { PlaceRelationView } from "@/server/services/placeRelationService";
import type { RecordRelationView } from "@/server/services/recordRelationService";
import type { RecordPlacement } from "@/world/inspectorModel";
import type { KindTemplateField } from "@/world/kindTemplates";
import { INFOBOX } from "@/ui/labels";
import {
  formatWorldKindFieldValue,
  worldbuildingCustomKind,
  worldbuildingKindFromFields,
  WORLD_KIND_FIELD_SPECS,
} from "@/world/worldKinds";
import { aliasesOf, type RecordCrossRefs } from "@/writing/crossRefs";
import { listSections, splitStatusTag } from "@/writing/sections";

export interface InfoboxRow {
  label: string;
  value: string;
  href?: string;
}

export interface InfoboxRelationship {
  label: string;
  href: string;
}

export interface ReferenceInfoboxModel {
  rows: InfoboxRow[];
  facts: string[];
  relationships: InfoboxRelationship[];
  maps: InfoboxRelationship[];
  /** Body excerpt under an Open questions heading, if present. */
  openQuestions: string | null;
}

export interface BuildReferenceInfoboxInput {
  projectId: string;
  record: Pick<RecordView, "id" | "title" | "type" | "body" | "fields">;
  bookOrderIds: readonly string[];
  crossRefs: RecordCrossRefs;
  acceptedFacts: readonly EstablishedFactView[];
  placeRelations: { outgoing: PlaceRelationView[]; incoming: PlaceRelationView[] } | null;
  recordRelations: { outgoing: RecordRelationView[]; incoming: RecordRelationView[] } | null;
  placements: readonly RecordPlacement[];
  /** Custom kind field labels for this book. Built-in kinds ignore this. */
  kindTemplates?: readonly { kind: string; fields: readonly KindTemplateField[] }[];
}

const OPEN_QUESTIONS = "open questions";
const MAX_FACTS = 12;
const MAX_RELATIONS = 8;

function recordHref(projectId: string, recordId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`;
}

function nameField(fields: Record<string, unknown>): string | null {
  const name = fields.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export function openQuestionsExcerpt(body: string): string | null {
  const section = listSections(body).find((item) => {
    const { title } = splitStatusTag(item.title);
    return title.trim().toLowerCase() === OPEN_QUESTIONS;
  });
  if (!section) return null;
  const text = body.slice(section.start, section.end).replace(/^#+\s.*\n?/, "").trim();
  return text || null;
}

function firstAppearance(
  projectId: string,
  crossRefs: RecordCrossRefs,
  bookOrderIds: readonly string[],
): InfoboxRow | null {
  if (!crossRefs.namedIn.length) return null;
  const rank = new Map(bookOrderIds.map((id, index) => [id, index]));
  const ordered = [...crossRefs.namedIn].sort((a, b) => {
    const ra = rank.get(a.recordId) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.recordId) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.title.localeCompare(b.title);
  });
  const first = ordered[0];
  if (!first) return null;
  return {
    label: "First appearance",
    value: first.title,
    href: recordHref(projectId, first.recordId),
  };
}

function parentPlaceRow(
  projectId: string,
  recordId: string,
  fields: Record<string, unknown>,
  placeRelations: BuildReferenceInfoboxInput["placeRelations"],
): InfoboxRow | null {
  const outgoing = placeRelations?.outgoing.find((row) => row.kind === "part_of" && row.fromRecordId === recordId);
  if (outgoing) {
    return { label: "Parent place", value: outgoing.toTitle, href: recordHref(projectId, outgoing.toRecordId) };
  }
  const fromFields = fields.parentPlace;
  const text = formatWorldKindFieldValue(fromFields as never);
  return text ? { label: "Parent place", value: text } : null;
}

function rowsForSpecs(
  fields: Record<string, unknown>,
  specs: readonly { key: string; label: string }[],
): InfoboxRow[] {
  return specs.flatMap((spec) => {
    if (spec.key === "parentPlace") return [];
    const value = formatWorldKindFieldValue(fields[spec.key] as never);
    return value ? [{ label: spec.label, value }] : [];
  });
}

function kindFieldRows(
  fields: Record<string, unknown>,
  templates: readonly { kind: string; fields: readonly KindTemplateField[] }[] | undefined,
): InfoboxRow[] {
  const kind = worldbuildingKindFromFields(fields);
  if (kind) return rowsForSpecs(fields, WORLD_KIND_FIELD_SPECS[kind]);
  const custom = worldbuildingCustomKind(fields);
  const template = custom ? templates?.find((item) => item.kind === custom) : undefined;
  return template ? rowsForSpecs(fields, template.fields) : [];
}

function relationRows(
  projectId: string,
  recordId: string,
  placeRelations: BuildReferenceInfoboxInput["placeRelations"],
  recordRelations: BuildReferenceInfoboxInput["recordRelations"],
): InfoboxRelationship[] {
  const out: InfoboxRelationship[] = [];
  for (const row of placeRelations?.outgoing ?? []) {
    if (row.fromRecordId !== recordId) continue;
    if (row.kind === "part_of") continue;
    out.push({
      label: `${row.kindLabel} ${row.toTitle}`,
      href: recordHref(projectId, row.toRecordId),
    });
  }
  for (const row of placeRelations?.incoming ?? []) {
    if (row.toRecordId !== recordId) continue;
    out.push({
      label: `${row.kindLabel} ${row.fromTitle}`,
      href: recordHref(projectId, row.fromRecordId),
    });
  }
  for (const row of recordRelations?.outgoing ?? []) {
    if (row.fromRecordId !== recordId) continue;
    out.push({
      label: `${row.kindLabel} ${row.toTitle}`,
      href: recordHref(projectId, row.toRecordId),
    });
  }
  for (const row of recordRelations?.incoming ?? []) {
    if (row.toRecordId !== recordId) continue;
    out.push({
      label: `${row.kindLabel} ${row.fromTitle}`,
      href: recordHref(projectId, row.fromRecordId),
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out.slice(0, MAX_RELATIONS);
}

function mapRows(projectId: string, placements: readonly RecordPlacement[]): InfoboxRelationship[] {
  const seen = new Set<string>();
  const out: InfoboxRelationship[] = [];
  for (const place of placements) {
    if (place.surface !== "map" || seen.has(place.surfaceId)) continue;
    seen.add(place.surfaceId);
    out.push({
      label: place.surfaceTitle,
      href: `/projects/${encodeURIComponent(projectId)}/world/maps/${encodeURIComponent(place.surfaceId)}`,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Computed on read from stored fields and links; nothing is inferred beyond existing cross-refs. */
export function buildReferenceInfobox(input: BuildReferenceInfoboxInput): ReferenceInfoboxModel | null {
  const { projectId, record } = input;
  if (!isRecordType(record.type) || !isLinkableReferenceType(record.type)) return null;

  const fields = record.fields as JsonObject;
  const rows: InfoboxRow[] = [];

  const displayName = nameField(fields);
  if (displayName && displayName !== record.title.trim()) {
    rows.push({ label: "Name", value: displayName });
  }

  const aliases = aliasesOf(fields);
  if (aliases.length) {
    rows.push({ label: "Aliases", value: aliases.join(", ") });
  }

  const role = typeof fields.role === "string" ? fields.role.trim() : "";
  if (role) rows.push({ label: INFOBOX.role, value: role });
  const summary = typeof fields.summary === "string" ? fields.summary.trim() : "";
  if (summary) rows.push({ label: INFOBOX.summary, value: summary });

  rows.push(...kindFieldRows(fields, input.kindTemplates));

  const parent = parentPlaceRow(projectId, record.id, fields, input.placeRelations);
  if (parent) rows.push(parent);

  const first = firstAppearance(projectId, input.crossRefs, input.bookOrderIds);
  if (first) rows.push(first);

  const relationships = relationRows(projectId, record.id, input.placeRelations, input.recordRelations);
  const maps = mapRows(projectId, input.placements);
  const facts = input.acceptedFacts
    .filter((fact) => fact.status === "accepted")
    .map((fact) => fact.statement.trim())
    .filter(Boolean)
    .slice(0, MAX_FACTS);
  const openQuestions = openQuestionsExcerpt(record.body);

  if (!rows.length && !facts.length && !relationships.length && !maps.length && !openQuestions) return null;

  return { rows, facts, relationships, maps, openQuestions };
}