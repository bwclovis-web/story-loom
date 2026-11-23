import { parseJsonObject, type JsonObject, type JsonValue } from "@/domain/json";
import { WORLD_PROFILE_KEY } from "@/domain/worldProfile";
import { isWorldKindKey } from "./referenceTemplates";
import { TAXONOMY_FIELD_KEY } from "./taxonomy";
import { WORLD_KIND_FIELD_SPECS } from "./worldKinds";

export type FieldDraft =
  | { ok: true; value: JsonObject }
  | { ok: false; error: string };

/** Parse the author's field JSON. Invalid text is an error, never `{}`. */
export function parseFieldDraft(text: string): FieldDraft {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: {} };
  try {
    return { ok: true, value: parseJsonObject(trimmed) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON" };
  }
}

export function fieldDraftText(value: JsonObject): string {
  return Object.keys(value).length ? JSON.stringify(value, null, 2) : "{}";
}

function kindSpecs(fields: JsonObject): readonly { key: string }[] {
  const kind = fields.kind;
  if (typeof kind !== "string" || !isWorldKindKey(kind)) return [];
  return WORLD_KIND_FIELD_SPECS[kind];
}

/** Keys that are not the current kind's friendly fields and not `kind` / taxonomy overlays. */
export function otherSavedEntries(fields: JsonObject): Array<{ key: string; value: JsonValue; editable: boolean }> {
  const known = new Set(kindSpecs(fields).map((spec) => spec.key));
  return Object.entries(fields)
    .filter(([key]) => key !== "kind" && key !== TAXONOMY_FIELD_KEY && key !== WORLD_PROFILE_KEY && !known.has(key))
    .map(([key, value]) => ({ key, value, editable: typeof value === "string" }));
}

export function valueShape(value: JsonValue): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}
