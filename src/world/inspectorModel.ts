import type { WorldScope } from "@/domain/assignments";
import type { AuthorityStatus } from "@/domain/statuses";
import type { JsonObject } from "@/domain/json";
import { isLinkableReferenceType, isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { developmentIsEmpty, profileFreshness, readCharacterDevelopment } from "@/domain/characterDevelopment";
import {
  formatWorldProfileFieldValue,
  isWorldProfileRecordType,
  readWorldProfile,
  worldProfileIsEmpty,
  WORLD_PROFILE_KEY,
} from "@/domain/worldProfile";
import { WORLD_PROFILE } from "@/ui/labels";
import type { SeriesHomeRef } from "@/world/seriesHome";
import { resolveRecordTaxonomy, taxonomyNavSummary, type TaxonomyNavSummary } from "@/world/taxonomy";
import { worldbuildingKindFromFields, worldKindDisplayFromFields } from "@/world/worldKinds";
import { listSections } from "@/writing/sections";
import { isWorldType } from "@/ui/world";

export interface InspectorSection {
  id: string;
  title: string;
  level: number;
  excerpt: string;
}

export interface InspectorImage {
  id: string;
  name: string;
  altText: string;
  caption: string;
}

export interface InspectorRelation {
  id: string;
  direction: "from" | "to";
  kindLabel: string;
  otherRecordId: string;
  otherTitle: string;
  otherTypeLabel: string;
}

export interface InspectorManuscriptLink {
  recordId: string;
  title: string;
  typeLabel: string;
  chapterTitle: string | null;
}

export interface RecordPlacement {
  surface: "board" | "map";
  surfaceId: string;
  surfaceTitle: string;
  itemId: string;
}

export interface ReferenceInspectorModel {
  id: string;
  title: string;
  recordType: RecordType;
  typeLabel: string;
  authorityStatus: AuthorityStatus;
  revision: number;
  protected: boolean;
  lead: string;
  fieldKeys: string[];
  sections: InspectorSection[];
  images: InspectorImage[];
  relations: InspectorRelation[];
  manuscriptLinks: InspectorManuscriptLink[];
  placements: RecordPlacement[];
  supportsEstablished: boolean;
  /** Character dossier, organization, or place records may use record relationships. */
  supportsRecordRelations: boolean;
  /** Set on worldbuilding records: kind label, or null when kind is unset. */
  worldKindLabel?: string | null;
  /** Short read-only development lines for a character dossier. */
  developmentLines: string[];
  developmentStale: boolean;
  /** Short read-only Living World Profile lines for a non-character World reference. */
  worldProfileLines: string[];
  /** Home book when this inspector is viewing a series-shared sibling record. */
  seriesHome: SeriesHomeRef | null;
  worldScope: WorldScope | null;
  /** Discovery taxonomy summary for badges (null when not a World type). */
  taxonomy: TaxonomyNavSummary | null;
}

const MAX_PROFILE_VALUE_LINES = 3;

function supportsRecordRelations(type: RecordType, fields: JsonObject | undefined): boolean {
  if (type === "character_dossier") return true;
  if (type === "worldbuilding") {
    const kind = worldbuildingKindFromFields(fields ?? {});
    return kind === "organization" || kind === "place";
  }
  return false;
}

function clip(text: string, max = 280): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}…`;
}

function sectionExcerpt(body: string, start: number, end: number): string {
  const raw = body.slice(start, end).replace(/^[^\n]*\n?/, "");
  return clip(raw);
}

export function placementHref(projectId: string, placement: RecordPlacement): string {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  if (placement.surface === "board") {
    return `${base}/world/boards/${encodeURIComponent(placement.surfaceId)}?card=${encodeURIComponent(placement.itemId)}`;
  }
  return `${base}/world/maps/${encodeURIComponent(placement.surfaceId)}?pin=${encodeURIComponent(placement.itemId)}`;
}

export function buildReferenceInspectorModel(input: {
  id: string;
  title: string;
  type: string;
  authorityStatus: AuthorityStatus;
  revision: number;
  protected: boolean;
  body: string;
  fields?: JsonObject;
  fieldKeys: readonly string[];
  images: InspectorImage[];
  relations: InspectorRelation[];
  manuscriptLinks: InspectorManuscriptLink[];
  placements: RecordPlacement[];
  seriesHome?: SeriesHomeRef | null;
  worldScope?: WorldScope | null;
}): ReferenceInspectorModel | null {
  if (!isRecordType(input.type)) return null;
  const development = input.type === "character_dossier" ? readCharacterDevelopment(input.fields ?? {}).profile : null;
  const developmentLines = development && !developmentIsEmpty(development)
    ? [
        development.importance ? `Importance: ${development.importance}` : "",
        development.narrativeRole ? `Role: ${development.narrativeRole.replaceAll("_", " ")}` : "",
        development.psychology.enneagram ? `Enneagram: ${development.psychology.enneagram}` : "",
        development.archetypes.length ? `Archetypes: ${development.archetypes.map((item) => item.name).slice(0, 3).join(", ")}` : "",
        development.arcs.length ? `Arcs: ${development.arcs.map((arc) => arc.title).slice(0, 3).join(", ")}` : "",
      ].filter(Boolean)
    : [];
  const worldProfileLines: string[] = [];
  if (isWorldProfileRecordType(input.type) && input.fields && WORLD_PROFILE_KEY in input.fields) {
    const { profile } = readWorldProfile(input.fields);
    if (!worldProfileIsEmpty(profile)) {
      if (profile.summary.trim()) worldProfileLines.push(clip(profile.summary, 160));
      if (profile.definitionId) worldProfileLines.push(`Definition: ${profile.definitionId}`);
      let shown = 0;
      for (const [key, value] of Object.entries(profile.values)) {
        if (shown >= MAX_PROFILE_VALUE_LINES) break;
        const text = formatWorldProfileFieldValue(value).trim();
        if (!text) continue;
        worldProfileLines.push(`${key}: ${clip(text, 120)}`);
        shown += 1;
      }
      if (profile.migrationHold.length) worldProfileLines.push(WORLD_PROFILE.holdCount(profile.migrationHold.length));
      const approved = Object.values(profile.fieldMeta).filter((meta) => meta.approval === "approved").length;
      if (approved) worldProfileLines.push(WORLD_PROFILE.approvedCount(approved));
    }
  }
  const sections = listSections(input.body);
  const first = sections[0];
  const leadSource =
    first && first.start > 0 ? input.body.slice(0, first.start) : first ? input.body.slice(first.start, first.end) : input.body;
  return {
    id: input.id,
    title: input.title,
    recordType: input.type,
    typeLabel: RECORD_TYPE_LABELS[input.type],
    authorityStatus: input.authorityStatus,
    revision: input.revision,
    protected: input.protected,
    lead: clip(leadSource),
    fieldKeys: [...input.fieldKeys],
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      level: section.level,
      excerpt: sectionExcerpt(input.body, section.start, section.end),
    })),
    images: input.images,
    relations: input.relations,
    manuscriptLinks: input.manuscriptLinks,
    placements: input.placements,
    supportsEstablished: isLinkableReferenceType(input.type),
    supportsRecordRelations: supportsRecordRelations(input.type, input.fields),
    worldKindLabel: input.type === "worldbuilding" ? worldKindDisplayFromFields(input.fields ?? {}) : undefined,
    developmentLines,
    developmentStale: development ? profileFreshness(development, input.revision) === "stale" : false,
    worldProfileLines,
    seriesHome: input.seriesHome ?? null,
    worldScope: input.worldScope ?? null,
    taxonomy: isWorldType(input.type)
      ? taxonomyNavSummary(resolveRecordTaxonomy({ type: input.type, fields: input.fields ?? {} }))
      : null,
  };
}
