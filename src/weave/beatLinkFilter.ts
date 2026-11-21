import type { RecordType } from "@/domain/recordTypes";

/** Plot-grid filter: cited character dossiers, cited places, or a scene point of view. */
export type WeaveLinkFilter =
  | { kind: "all" }
  | { kind: "character" }
  | { kind: "location" }
  | { kind: "pov"; pov: string };

export interface BeatLinkRef {
  type: RecordType | string;
  worldKind: string | null;
  unavailable?: boolean;
}

export interface BeatLinkFields {
  worldRefs: BeatLinkRef[];
  manuscriptPov: string;
}

export function beatMatchesLinkFilter(beat: BeatLinkFields, filter: WeaveLinkFilter): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "character") return citesCharacter(beat);
  if (filter.kind === "location") return citesLocation(beat);
  const pov = beat.manuscriptPov.trim();
  if (!filter.pov) return pov.length > 0;
  return pov === filter.pov;
}

export function beatLinkTagClass(beat: BeatLinkFields): string {
  const tags = [
    citesCharacter(beat) ? "tag-character" : "",
    citesLocation(beat) ? "tag-location" : "",
    beat.manuscriptPov.trim() ? "tag-pov" : "",
  ].filter(Boolean);
  return tags.length ? ` ${tags.join(" ")}` : "";
}

function live(ref: BeatLinkRef): boolean {
  return !ref.unavailable;
}

function citesCharacter(beat: BeatLinkFields): boolean {
  return beat.worldRefs.some((ref) => live(ref) && ref.type === "character_dossier");
}

function citesLocation(beat: BeatLinkFields): boolean {
  return beat.worldRefs.some((ref) => live(ref) && ref.type === "worldbuilding" && ref.worldKind === "place");
}
