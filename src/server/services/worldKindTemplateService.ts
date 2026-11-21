import { newId } from "@/domain/ids";
import type { JsonValue } from "@/domain/json";
import {
  kindTemplateFieldsJson,
  parseKindTemplateFields,
  type KindTemplateField,
  type KindTemplateView,
} from "@/world/kindTemplates";
import { worldbuildingKindRaw } from "@/world/worldKinds";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { NotFoundError } from "./errors";

function missingTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2021";
}

function toView(row: { id: string; projectId: string; kind: string; fieldsJson: string }): KindTemplateView {
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(row.fieldsJson) as unknown;
  } catch {
    parsed = [];
  }
  return { id: row.id, projectId: row.projectId, kind: row.kind, fields: parseKindTemplateFields(parsed) };
}

/** Custom kind field definitions for one book. Empty when the table is not migrated yet. */
export async function listWorldKindTemplates(db: DbOrTx, projectId: string): Promise<KindTemplateView[]> {
  try {
    const rows = await db.worldKindTemplate.findMany({
      where: { projectId },
      orderBy: [{ kind: "asc" }, { id: "asc" }],
    });
    return rows.map(toView);
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

export async function saveWorldKindTemplate(
  db: Db,
  input: { projectId: string; kind: string; fields: readonly KindTemplateField[]; actor?: string },
): Promise<KindTemplateView> {
  const kind = input.kind.trim().slice(0, 120);
  if (!kind) throw new Error("Custom kind name is required");
  const fields = parseKindTemplateFields(input.fields);
  if (!fields.length) throw new Error("Add at least one field");
  const project = await db.project.findFirst({ where: { id: input.projectId, trashedAt: null }, select: { id: true } });
  if (!project) throw new NotFoundError(`Project ${input.projectId} not found`);
  const fieldsJson = kindTemplateFieldsJson(fields);
  const existing = await db.worldKindTemplate.findUnique({ where: { projectId_kind: { projectId: project.id, kind } } });
  const saved = existing
    ? await db.worldKindTemplate.update({ where: { id: existing.id }, data: { fieldsJson } })
    : await db.worldKindTemplate.create({
        data: { id: newId("wkt"), projectId: project.id, kind, fieldsJson },
      });
  await writeAudit(db, {
    projectId: project.id,
    action: existing ? "world_kind_template.update" : "world_kind_template.create",
    actor: input.actor ?? "author",
    summary: `Remembered fields for custom kind "${kind}"`,
    details: { templateId: saved.id, kind, keys: fields.map((field) => field.key) } satisfies JsonValue,
  });
  return toView(saved);
}

export async function deleteWorldKindTemplate(
  db: Db,
  input: { projectId: string; kind: string; actor?: string },
): Promise<void> {
  const kind = input.kind.trim();
  const existing = await db.worldKindTemplate.findUnique({
    where: { projectId_kind: { projectId: input.projectId, kind } },
  });
  if (!existing || existing.projectId !== input.projectId) return;
  await db.worldKindTemplate.delete({ where: { id: existing.id } });
  await writeAudit(db, {
    projectId: input.projectId,
    action: "world_kind_template.delete",
    actor: input.actor ?? "author",
    summary: `Forgot fields for custom kind "${kind}"`,
    details: { templateId: existing.id, kind },
  });
}

/** Template whose kind name matches this record's custom `fields.kind`, if any. */
export function templateForFields(
  templates: readonly KindTemplateView[],
  fields: unknown,
): KindTemplateView | null {
  const kind = worldbuildingKindRaw(fields);
  if (!kind) return null;
  return templates.find((template) => template.kind === kind) ?? null;
}
