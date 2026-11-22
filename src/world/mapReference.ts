import { type RecordType } from "@/domain/recordTypes";

/** Document types a map image may be stored on when the author creates the reference here. */
export const MAP_REFERENCE_TYPES = [
  "character_dossier",
  "worldbuilding",
  "rules_glossary",
  "research_note",
] as const satisfies readonly RecordType[];

export type MapReferenceType = (typeof MAP_REFERENCE_TYPES)[number];

export function isMapReferenceType(value: string): value is MapReferenceType {
  return (MAP_REFERENCE_TYPES as readonly string[]).includes(value);
}
