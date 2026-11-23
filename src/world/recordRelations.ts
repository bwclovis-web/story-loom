import type { RelationScope } from "@/domain/assignments";
import type { AuthorityStatus } from "@/domain/statuses";
import type { RecordType } from "@/domain/recordTypes";
import { parseJsonObject } from "@/domain/json";
import { worldbuildingKindFromFields } from "@/world/worldKinds";

export const MAX_RECORD_RELATION_LABEL_CHARS = 64;

export const RECORD_RELATION_KINDS = [
  "parent_of",
  "sibling_of",
  "spouse_of",
  "member_of",
  "leads",
  "serves",
  "allied_with",
  "rival_of",
  "custom",
] as const;

export type RecordRelationKind = (typeof RECORD_RELATION_KINDS)[number];

export const RECORD_RELATION_LABELS: Record<Exclude<RecordRelationKind, "custom">, string> = {
  parent_of: "Parent of",
  sibling_of: "Sibling of",
  spouse_of: "Spouse of",
  member_of: "Member of",
  leads: "Leads",
  serves: "Serves",
  allied_with: "Allied with",
  rival_of: "Rival of",
};

export function isRecordRelationKind(v: string): v is RecordRelationKind {
  return (RECORD_RELATION_KINDS as readonly string[]).includes(v);
}

export function recordRelationKindLabel(kind: RecordRelationKind, customLabel = ""): string {
  if (kind === "custom") {
    const label = customLabel.trim();
    return label || "Custom";
  }
  return RECORD_RELATION_LABELS[kind];
}

/** Records that may appear on the Relationships tab or as relation endpoints. */
export function isRecordRelationEndpoint(type: RecordType, fields: unknown): boolean {
  if (type === "character_dossier") return true;
  if (type === "worldbuilding") {
    const kind = worldbuildingKindFromFields(fields);
    return kind === "organization" || kind === "place";
  }
  return false;
}

export function recordShowsRecordRelations(type: RecordType, fields: unknown): boolean {
  return isRecordRelationEndpoint(type, fields);
}

export interface RecordRelationView {
  id: string;
  kind: RecordRelationKind;
  kindLabel: string;
  customLabel: string;
  scope: RelationScope;
  fromRecordId: string;
  fromTitle: string;
  fromTypeLabel: string;
  fromStatus: AuthorityStatus;
  toRecordId: string;
  toTitle: string;
  toTypeLabel: string;
  toStatus: AuthorityStatus;
  createdAt: Date;
}

/** Re-export for callers that already parse fields as JSON strings. */
export function fieldsObject(fields: unknown) {
  return typeof fields === "string" ? parseJsonObject(fields) : fields;
}
