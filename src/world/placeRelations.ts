import type { RelationScope } from "@/domain/assignments";
import type { AuthorityStatus } from "@/domain/statuses";

export const PLACE_RELATION_KINDS = ["part_of", "flows_into", "governed_by"] as const;
export type PlaceRelationKind = (typeof PLACE_RELATION_KINDS)[number];

export const PLACE_RELATION_LABELS: Record<PlaceRelationKind, string> = {
  part_of: "Part of",
  flows_into: "Flows into",
  governed_by: "Governed by",
};

export function isPlaceRelationKind(v: string): v is PlaceRelationKind {
  return (PLACE_RELATION_KINDS as readonly string[]).includes(v);
}

export interface PlaceRelationView {
  id: string;
  kind: PlaceRelationKind;
  kindLabel: string;
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
