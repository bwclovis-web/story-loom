import { CHARACTER_DEVELOPMENT_KEY } from "@/domain/characterDevelopment";
import type { JsonObject, JsonValue } from "@/domain/json";
import { WORLD_PROFILE_KEY } from "@/domain/worldProfile";

/**
 * Typed ID remapping for backup restore (`idStrategy: "remap"`).
 * Only known reference keys are rewritten. Prose, archive text, unknown
 * extension keys, and literal strings that happen to equal an old ID stay put.
 */

const PROJECT_ID_KEYS = new Set(["bookProjectId", "projectId"]);
const RECORD_ID_KEYS = new Set([
  "recordId",
  "chapterRecordId",
  "sceneRecordId",
  "foundationRecordId",
  "linkedRecordId",
  "relationshipRecordId",
  "referenceRecordId",
  "manuscriptRecordId",
  "worldRecordId",
  "parentArcId",
]);
const EVENT_ID_KEYS = new Set(["storyEventId", "fromStoryEventId", "untilStoryEventId"]);
const DRAFT_ID_KEYS = new Set(["draftId"]);
const FACT_ID_KEYS = new Set(["establishedFactId"]);
const RELATION_ID_KEYS = new Set(["relationId"]);
const WEAVE_ID_KEYS = new Set(["weaveBeatId"]);

const STRING_ARRAY_ID_KEYS = new Set(["linkedRecordIds", "participantRecordIds"]);

function remapId(value: string, map: ReadonlyMap<string, string>): string {
  return map.get(value) ?? value;
}

function remapByKey(key: string, value: JsonValue, map: ReadonlyMap<string, string>): JsonValue {
  if (typeof value === "string") {
    if (
      PROJECT_ID_KEYS.has(key) ||
      RECORD_ID_KEYS.has(key) ||
      EVENT_ID_KEYS.has(key) ||
      DRAFT_ID_KEYS.has(key) ||
      FACT_ID_KEYS.has(key) ||
      RELATION_ID_KEYS.has(key) ||
      WEAVE_ID_KEYS.has(key)
    ) {
      return remapId(value, map);
    }
    return value;
  }
  if (value === null) return value;
  if (STRING_ARRAY_ID_KEYS.has(key) && Array.isArray(value)) {
    return value.map((entry) => (typeof entry === "string" ? remapId(entry, map) : entry));
  }
  if (Array.isArray(value)) {
    return value.map((entry) => remapDeep(entry, map));
  }
  if (typeof value === "object") {
    return remapDeep(value, map);
  }
  return value;
}

function remapDeep(value: JsonValue, map: ReadonlyMap<string, string>): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => remapDeep(entry, map));
  if (!value || typeof value !== "object") return value;
  const out: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = remapByKey(key, child as JsonValue, map);
  }
  return out;
}

/** Remap typed references inside record/revision `fields` JSON. */
export function remapRecordFields(fields: JsonObject, map: ReadonlyMap<string, string>): JsonObject {
  const out: JsonObject = { ...fields };
  const world = out[WORLD_PROFILE_KEY];
  if (world && typeof world === "object" && !Array.isArray(world)) {
    out[WORLD_PROFILE_KEY] = remapDeep(world, map);
  }
  const character = out[CHARACTER_DEVELOPMENT_KEY];
  if (character && typeof character === "object" && !Array.isArray(character)) {
    out[CHARACTER_DEVELOPMENT_KEY] = remapDeep(character, map);
  }
  return out;
}

/** Remap only ID-bearing SmartCollection filter keys; keep other / unknown keys. */
export function remapSmartCollectionFilterJson(filterJson: string, map: ReadonlyMap<string, string>): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(filterJson) as unknown;
  } catch {
    return filterJson;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return filterJson;
  const next: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  if (typeof next.draftId === "string") next.draftId = remapId(next.draftId, map);
  if (typeof next.linkedRecordId === "string") next.linkedRecordId = remapId(next.linkedRecordId, map);
  return JSON.stringify(next);
}
