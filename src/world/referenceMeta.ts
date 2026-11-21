import type { JsonObject } from "@/domain/json";

/** Friendly fields stored inside a reference record's JSON. Other keys stay. */
export interface ReferenceMeta {
  name: string;
  aliases: string[];
  role: string;
  summary: string;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function readReferenceMeta(fields: Readonly<Record<string, unknown>>): ReferenceMeta {
  const raw = fields.aliases;
  const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  const aliases = [...new Set(list.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
  return {
    name: textOf(fields.name).trim(),
    aliases,
    role: textOf(fields.role).trim(),
    summary: textOf(fields.summary).trim(),
  };
}

/** Set or clear the named keys. Every other JSON key is copied through. */
export function withReferenceMeta(fields: JsonObject, meta: Partial<ReferenceMeta>): JsonObject {
  const next: JsonObject = { ...fields };
  const setText = (key: "name" | "role" | "summary", value: string) => {
    const trimmed = value.trim();
    if (trimmed) next[key] = trimmed;
    else delete next[key];
  };
  if (meta.name !== undefined) setText("name", meta.name);
  if (meta.role !== undefined) setText("role", meta.role);
  if (meta.summary !== undefined) setText("summary", meta.summary);
  if (meta.aliases !== undefined) {
    const aliases = [...new Set(meta.aliases.map((alias) => alias.trim()).filter(Boolean))];
    if (aliases.length) next.aliases = aliases;
    else delete next.aliases;
  }
  return next;
}
