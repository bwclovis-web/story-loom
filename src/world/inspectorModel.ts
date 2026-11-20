import type { AuthorityStatus } from "@/domain/statuses";
import type { JsonObject } from "@/domain/json";
import { isLinkableReferenceType, isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { worldKindDisplayFromFields } from "@/world/worldKinds";
import { listSections } from "@/writing/sections";

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
  /** Set on worldbuilding records: kind label, or null when kind is unset. */
  worldKindLabel?: string | null;
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
}): ReferenceInspectorModel | null {
  if (!isRecordType(input.type)) return null;
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
    worldKindLabel: input.type === "worldbuilding" ? worldKindDisplayFromFields(input.fields ?? {}) : undefined,
  };
}
