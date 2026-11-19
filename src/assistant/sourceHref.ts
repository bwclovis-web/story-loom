import type { RetrievalSourceNote } from "./retrievalMeta";
import { WORLD } from "@/ui/labels";

/** Where a retrieved source opens: a scene or place, a story event, or a map marker. */
export function retrievalSourceHref(
  projectId: string,
  source: Pick<RetrievalSourceNote, "recordId" | "eventId" | "mapId" | "pinId">,
): string | null {
  const project = encodeURIComponent(projectId);
  if (source.eventId) {
    return `/projects/${project}/world/events?event=${encodeURIComponent(source.eventId)}`;
  }
  if (source.mapId) {
    const pin = source.pinId ? `?pin=${encodeURIComponent(source.pinId)}` : "";
    return `/projects/${project}/world/maps/${encodeURIComponent(source.mapId)}${pin}`;
  }
  if (source.recordId) return `/projects/${project}/records/${encodeURIComponent(source.recordId)}`;
  return null;
}

export function retrievalSourceLabel(source: Pick<RetrievalSourceNote, "title" | "evidenceLabel" | "revision" | "passageStart" | "passageEnd" | "stale">): string {
  const bits = [source.title];
  if (source.evidenceLabel) bits.push(source.evidenceLabel);
  if (source.passageStart != null && source.passageEnd != null) bits.push(`pinned rev ${source.revision}`);
  else if (source.revision) bits.push(`rev ${source.revision}`);
  if (source.stale) bits.push(WORLD.needsRecheck);
  return bits.join(" · ");
}
