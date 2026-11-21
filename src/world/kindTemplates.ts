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
