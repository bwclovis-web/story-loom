import type { JsonObject, JsonValue } from "@/domain/json";
import {
  isReferenceTemplateKey,
  referenceTemplate,
  REFERENCE_TEMPLATE_KEYS,
  type ReferenceTemplateKey,
} from "./referenceTemplates";

/** Optional structured fields per Worldbuilding kind (stored in `fields`, alongside `kind`). */
export interface WorldKindFieldSpec {
  key: string;
  label: string;
  placeholder?: string;
}

export const WORLD_KIND_FIELD_SPECS: Record<ReferenceTemplateKey, readonly WorldKindFieldSpec[]> = {
  place: [
    { key: "parentPlace", label: "Parent place", placeholder: "Region or parent location" },
    { key: "climate", label: "Climate", placeholder: "e.g. Temperate coast" },
  ],
  religion: [
    { key: "focus", label: "Central belief or deity", placeholder: "What the faith revolves around" },
    { key: "heartland", label: "Heartland", placeholder: "Where it is strongest" },
  ],
  culture: [
    { key: "people", label: "People", placeholder: "Who practices this culture" },
    { key: "region", label: "Region", placeholder: "Where it is found" },
  ],
  organization: [
    { key: "goal", label: "Goal", placeholder: "What the organization wants" },
    { key: "headquarters", label: "Headquarters", placeholder: "Main base or seat" },
  ],
  species: [
    { key: "habitat", label: "Habitat", placeholder: "Where they live" },
    { key: "traits", label: "Distinguishing traits", placeholder: "What sets them apart" },
  ],
  magic_system: [
    { key: "source", label: "Source", placeholder: "Where magic comes from" },
    { key: "limits", label: "Limits", placeholder: "What cannot be done" },
  ],
  object: [
    { key: "origin", label: "Origin", placeholder: "Where it came from" },
    { key: "keeper", label: "Current holder", placeholder: "Who has it now" },
  ],
  language: [
    { key: "speakers", label: "Speakers", placeholder: "Who speaks it" },
    { key: "writing", label: "Writing system", placeholder: "Script or marks" },
  ],
};

export const WORLDBUILDING_KIND_UNSET = "__none" as const;
/** Nav filter: records whose `fields.kind` is a free-text label, not one of the eight built-ins. */
export const WORLDBUILDING_KIND_OTHER = "__other" as const;
/** Select value in the editor only; never stored in `fields.kind`. */
export const WORLD_KIND_CUSTOM_UI = "__custom__" as const;

export type WorldbuildingKindFilter =
  | ReferenceTemplateKey
  | typeof WORLDBUILDING_KIND_UNSET
  | typeof WORLDBUILDING_KIND_OTHER;

const MAX_CUSTOM_KIND_LEN = 120;

function worldbuildingKindText(fields: unknown): string | null {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  const kind = (fields as JsonObject).kind;
  if (typeof kind !== "string") return null;
  return kind.trim() ? kind.slice(0, MAX_CUSTOM_KIND_LEN) : null;
}

export function worldbuildingKindRaw(fields: unknown): string | null {
  const text = worldbuildingKindText(fields);
  return text ? text.trim() : null;
}

export function worldbuildingKindFromFields(fields: unknown): ReferenceTemplateKey | null {
  const raw = worldbuildingKindRaw(fields);
  return raw && isReferenceTemplateKey(raw) ? raw : null;
}

/**
 * Kind control in the editor. `customPending` is local UI state: the author
 * chose Custom… and has not typed a name yet, so nothing is stored in `fields.kind`.
 */
export function worldKindEditorMode(
  fields: unknown,
  customPending: boolean,
): { selectValue: string; customName: string } {
  const text = worldbuildingKindText(fields);
  const raw = text ? text.trim() : null;
  const known = raw && isReferenceTemplateKey(raw) ? raw : null;
  const customName = text && !known ? text : "";
  const showCustom = Boolean(customName) || (customPending && !known);
  return {
    selectValue: showCustom ? WORLD_KIND_CUSTOM_UI : (known ?? ""),
    customName,
  };
}

export function worldbuildingCustomKind(fields: unknown): string | null {
  const raw = worldbuildingKindRaw(fields);
  return raw && !isReferenceTemplateKey(raw) ? raw : null;
}

/** Label for badges and tables: built-in name or the author&apos;s custom string. */
export function worldKindDisplayFromFields(fields: unknown): string | null {
  const raw = worldbuildingKindRaw(fields);
  if (!raw) return null;
  return isReferenceTemplateKey(raw) ? worldKindLabel(raw) : raw;
}

export function worldKindLabel(key: ReferenceTemplateKey): string {
  return referenceTemplate(key).label;
}

/** Keep author-set `kind` strings; trim and cap length. Never infer a kind. */
export function sanitizeWorldbuildingFields(fields: JsonObject): JsonObject {
  const next = { ...fields };
  const kind = next.kind;
  if (kind === undefined) return next;
  if (typeof kind !== "string") {
    delete next.kind;
    return next;
  }
  const trimmed = kind.trim().slice(0, MAX_CUSTOM_KIND_LEN);
  if (trimmed) next.kind = trimmed;
  else delete next.kind;
  return next;
}

export function applyWorldKindToFields(
  fields: JsonObject,
  kind: string,
  typedValues: Readonly<Record<string, string>>,
): JsonObject {
  const next: JsonObject = { ...fields };
  if (kind === "" || kind === WORLD_KIND_CUSTOM_UI) {
    delete next.kind;
    return next;
  }
  if (isReferenceTemplateKey(kind)) {
    next.kind = kind;
    for (const spec of WORLD_KIND_FIELD_SPECS[kind]) {
      const value = (typedValues[spec.key] ?? "").trim();
      if (value) next[spec.key] = value;
      else delete next[spec.key];
    }
    return next;
  }
  const custom = kind.slice(0, MAX_CUSTOM_KIND_LEN);
  // Keep a trailing space while the name is being typed. Save still trims.
  if (custom.trim()) next.kind = custom;
  else delete next.kind;
  return next;
}

export function worldKindCounts(
  records: readonly { type: string; worldKind?: ReferenceTemplateKey | null; customKind?: string | null }[],
): Record<WorldbuildingKindFilter, number> {
  const counts = Object.fromEntries(REFERENCE_TEMPLATE_KEYS.map((k) => [k, 0])) as Record<ReferenceTemplateKey, number>;
  let none = 0;
  let other = 0;
  for (const r of records) {
    if (r.type !== "worldbuilding") continue;
    if (r.worldKind) counts[r.worldKind] += 1;
    else if (r.customKind) other += 1;
    else none += 1;
  }
  return { ...counts, [WORLDBUILDING_KIND_UNSET]: none, [WORLDBUILDING_KIND_OTHER]: other };
}

export function isWorldbuildingKindFilter(value: string | null | undefined): value is WorldbuildingKindFilter {
  return (
    value === WORLDBUILDING_KIND_UNSET ||
    value === WORLDBUILDING_KIND_OTHER ||
    (!!value && isReferenceTemplateKey(value))
  );
}

export function formatWorldKindFieldValue(value: JsonValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}