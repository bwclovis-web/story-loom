import type { WorldScope } from "@/domain/assignments";
import type { SeriesHomeRef } from "@/world/seriesHome";

/** One author-defined field on a custom worldbuilding kind. */
export interface KindTemplateField {
  key: string;
  label: string;
  multiline: boolean;
}

export interface KindTemplateView {
  id: string;
  projectId: string;
  kind: string;
  fields: KindTemplateField[];
  /** null/book = local; series = shared to sibling books (never overrides local). */
  worldScope: WorldScope | null;
  /** Set when this template was loaded from a sibling book. */
  home: SeriesHomeRef | null;
  /** Stable registry id for Living World Profile lookup; null for legacy templates. */
  definitionId?: string | null;
  /** Display label; falls back to kind when null/empty. */
  label?: string | null;
  description?: string;
  categorySlug?: string | null;
  subcategorySlug?: string | null;
  /** Typed profile field/collection specs JSON; null = legacy flat only. */
  profileSpecJson?: string | null;
}

const FIELD_KEY = /^[a-z][a-zA-Z0-9]{0,40}$/;
export const MAX_KIND_TEMPLATE_FIELDS = 12;
export const MAX_KIND_TEMPLATE_LABEL = 80;

/** Drop blank, duplicate, and reserved keys. Order is the author's order. */
export function parseKindTemplateFields(raw: unknown): KindTemplateField[] {
  if (!Array.isArray(raw)) return [];
  const out: KindTemplateField[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!FIELD_KEY.test(key) || key === "kind" || seen.has(key)) continue;
    if (!label || label.length > MAX_KIND_TEMPLATE_LABEL) continue;
    seen.add(key);
    out.push({ key, label, multiline: record.multiline === true });
    if (out.length >= MAX_KIND_TEMPLATE_FIELDS) break;
  }
  return out;
}

export function kindTemplateFieldsJson(fields: readonly KindTemplateField[]): string {
  return JSON.stringify(
    parseKindTemplateFields(fields).map((field) => ({
      key: field.key,
      label: field.label,
      ...(field.multiline ? { multiline: true } : {}),
    })),
  );
}
