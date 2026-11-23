import { isWorldScope, type WorldScope } from "@/domain/assignments";
import { newId } from "@/domain/ids";
import type { JsonValue } from "@/domain/json";
import {
  kindTemplateFieldsJson,
  parseKindTemplateFields,
  type KindTemplateField,
  type KindTemplateView,
} from "@/world/kindTemplates";
import {
  resolveWorldProfileDefinition,
  type WorldProfileDefinition,
} from "@/world/worldProfileRegistry";
import { worldbuildingKindRaw } from "@/world/worldKinds";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { NotFoundError } from "./errors";
import { listSeriesBookProjects } from "./projectService";
import { emptyWorldProfile } from "@/domain/worldProfile";

function missingTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2021";
}

/** P2022: column missing (pre-W5A DB still has the table). */
function missingColumn(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2022";
}

function toView(
  row: {
    id: string;
    projectId: string;
    kind: string;
    fieldsJson: string;
    worldScope?: string | null;
    definitionId?: string | null;
    label?: string | null;
    description?: string | null;
    categorySlug?: string | null;
    subcategorySlug?: string | null;
    profileSpecJson?: string | null;
  },
  home: KindTemplateView["home"] = null,
): KindTemplateView {
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(row.fieldsJson) as unknown;
  } catch {
    parsed = [];
  }
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    fields: parseKindTemplateFields(parsed),
    worldScope: isWorldScope(row.worldScope) ? row.worldScope : null,
    home,
    definitionId: row.definitionId ?? null,
    label: row.label ?? null,
    description: row.description ?? "",
    categorySlug: row.categorySlug ?? null,
    subcategorySlug: row.subcategorySlug ?? null,
    profileSpecJson: row.profileSpecJson ?? null,
  };
}

/** Custom kind field definitions for one book. Empty when the table is not migrated yet. */
export async function listWorldKindTemplates(db: DbOrTx, projectId: string): Promise<KindTemplateView[]> {
  try {
    const rows = await db.worldKindTemplate.findMany({
      where: { projectId },
      orderBy: [{ kind: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => toView(row));
  } catch (error) {
    if (missingTable(error)) return [];
    // Pre-W5A: table exists without profile columns. Read legacy columns only.
    if (missingColumn(error)) {
      try {
        const rows = await db.worldKindTemplate.findMany({
          where: { projectId },
          orderBy: [{ kind: "asc" }, { id: "asc" }],
          select: {
            id: true,
            projectId: true,
            kind: true,
            fieldsJson: true,
            worldScope: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        return rows.map((row) => toView(row));
      } catch (inner) {
        if (!missingColumn(inner)) throw inner;
        const rows = await db.worldKindTemplate.findMany({
          where: { projectId },
          orderBy: [{ kind: "asc" }, { id: "asc" }],
          select: {
            id: true,
            projectId: true,
            kind: true,
            fieldsJson: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        return rows.map((row) => toView(row));
      }
    }
    throw error;
  }
}

/**
 * Local templates plus sibling `worldScope = series` templates. Local kinds win
 * when names collide; siblings are tagged with `home` and never overwrite local.
 */
export async function listAvailableWorldKindTemplates(
  db: DbOrTx,
  viewingProjectId: string,
): Promise<KindTemplateView[]> {
  const local = await listWorldKindTemplates(db, viewingProjectId);
  const localKinds = new Set(local.map((template) => template.kind));
  const books = await listSeriesBookProjects(db, viewingProjectId);
  const siblings = books.filter((book) => book.id !== viewingProjectId);
  if (!siblings.length) return local;
  try {
    const rows = await db.worldKindTemplate.findMany({
      where: {
        projectId: { in: siblings.map((book) => book.id) },
        worldScope: "series",
      },
      orderBy: [{ kind: "asc" }, { id: "asc" }],
    });
    const homes = new Map(
      siblings.map((book) => [book.id, { projectId: book.id, title: book.title, bookName: book.bookName }]),
    );
    const shared = rows.flatMap((row) => {
      if (localKinds.has(row.kind)) return [];
      const home = homes.get(row.projectId) ?? null;
      return [toView(row, home)];
    });
    return [...local, ...shared];
  } catch (error) {
    if (missingTable(error)) return local;
    if (missingColumn(error)) {
      try {
        const rows = await db.worldKindTemplate.findMany({
          where: {
            projectId: { in: siblings.map((book) => book.id) },
            worldScope: "series",
          },
          orderBy: [{ kind: "asc" }, { id: "asc" }],
          select: {
            id: true,
            projectId: true,
            kind: true,
            fieldsJson: true,
            worldScope: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        const homes = new Map(
          siblings.map((book) => [book.id, { projectId: book.id, title: book.title, bookName: book.bookName }]),
        );
        const shared = rows.flatMap((row) => {
          if (localKinds.has(row.kind)) return [];
          return [toView(row, homes.get(row.projectId) ?? null)];
        });
        return [...local, ...shared];
      } catch (inner) {
        if (missingTable(inner) || missingColumn(inner)) return local;
        throw inner;
      }
    }
    throw error;
  }
}

export async function saveWorldKindTemplate(
  db: Db,
  input: {
    projectId: string;
    kind: string;
    fields: readonly KindTemplateField[];
    worldScope?: WorldScope | null;
    definitionId?: string | null;
    label?: string | null;
    description?: string;
    categorySlug?: string | null;
    subcategorySlug?: string | null;
    profileSpecJson?: string | null;
    actor?: string;
  },
): Promise<KindTemplateView> {
  const kind = input.kind.trim().slice(0, 120);
  if (!kind) throw new Error("Custom kind name is required");
  const fields = parseKindTemplateFields(input.fields);
  if (!fields.length && !input.profileSpecJson?.trim()) throw new Error("Add at least one field");
  const project = await db.project.findFirst({ where: { id: input.projectId, trashedAt: null }, select: { id: true } });
  if (!project) throw new NotFoundError(`Project ${input.projectId} not found`);
  const fieldsJson = kindTemplateFieldsJson(fields);
  const worldScope = input.worldScope === undefined ? undefined : input.worldScope;
  const existing = await db.worldKindTemplate.findUnique({ where: { projectId_kind: { projectId: project.id, kind } } });
  const extras = {
    ...(input.definitionId !== undefined ? { definitionId: input.definitionId } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.categorySlug !== undefined ? { categorySlug: input.categorySlug } : {}),
    ...(input.subcategorySlug !== undefined ? { subcategorySlug: input.subcategorySlug } : {}),
    ...(input.profileSpecJson !== undefined ? { profileSpecJson: input.profileSpecJson } : {}),
  };
  const saved = existing
    ? await db.worldKindTemplate.update({
        where: { id: existing.id },
        data: {
          fieldsJson,
          ...(worldScope !== undefined ? { worldScope } : {}),
          ...extras,
        },
      })
    : await db.worldKindTemplate.create({
        data: {
          id: newId("wkt"),
          projectId: project.id,
          kind,
          fieldsJson,
          worldScope: worldScope ?? null,
          definitionId: input.definitionId ?? null,
          label: input.label ?? null,
          description: input.description ?? "",
          categorySlug: input.categorySlug ?? null,
          subcategorySlug: input.subcategorySlug ?? null,
          profileSpecJson: input.profileSpecJson ?? null,
        },
      });
  await writeAudit(db, {
    projectId: project.id,
    action: existing ? "world_kind_template.update" : "world_kind_template.create",
    actor: input.actor ?? "author",
    summary: `Remembered fields for custom kind "${kind}"`,
    details: {
      templateId: saved.id,
      kind,
      keys: fields.map((field) => field.key),
      worldScope: saved.worldScope ?? null,
      definitionId: saved.definitionId ?? null,
    } satisfies JsonValue,
  });
  return toView(saved);
}

export async function setWorldKindTemplateScope(
  db: Db,
  input: { projectId: string; kind: string; worldScope: WorldScope | null; actor?: string },
): Promise<KindTemplateView | null> {
  const kind = input.kind.trim();
  const existing = await db.worldKindTemplate.findUnique({
    where: { projectId_kind: { projectId: input.projectId, kind } },
  });
  if (!existing || existing.projectId !== input.projectId) return null;
  const saved = await db.worldKindTemplate.update({
    where: { id: existing.id },
    data: { worldScope: input.worldScope },
  });
  await writeAudit(db, {
    projectId: input.projectId,
    action: "world_kind_template.scope",
    actor: input.actor ?? "author",
    summary:
      input.worldScope === "series"
        ? `Shared custom kind "${kind}" with the series`
        : `Kept custom kind "${kind}" in this book only`,
    details: { templateId: existing.id, kind, worldScope: input.worldScope },
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

/**
 * Resolve a record's template by matching `(record.projectId, fields.kind)` first
 * so two books never collide on the same custom kind name. Falls back to an
 * available series-shared sibling template only when the home book has none.
 */
export function templateForRecord(
  homeTemplates: readonly KindTemplateView[],
  availableTemplates: readonly KindTemplateView[],
  recordProjectId: string,
  fields: unknown,
): KindTemplateView | null {
  const kind = worldbuildingKindRaw(fields);
  if (!kind) return null;
  const home = homeTemplates.find((template) => template.projectId === recordProjectId && template.kind === kind);
  if (home) return home;
  return availableTemplates.find((template) => template.kind === kind) ?? null;
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

/**
 * Resolve a Living World Profile definition using the record's home project first
 * so sibling books never collide on identically named templates.
 */
export function resolveProfileDefinitionForRecord(input: {
  fields: Readonly<Record<string, unknown>>;
  recordProjectId: string;
  homeTemplates: readonly KindTemplateView[];
  availableTemplates: readonly KindTemplateView[];
  definitionId?: string | null;
  categorySlug?: string | null;
  categorySlugs?: readonly string[];
}): WorldProfileDefinition | null {
  const profile = input.definitionId
    ? { ...emptyWorldProfile(), definitionId: input.definitionId }
    : null;
  const homeFirst = [
    ...input.homeTemplates.filter((t) => t.projectId === input.recordProjectId),
    ...input.availableTemplates.filter((t) => t.projectId !== input.recordProjectId),
  ];
  return resolveWorldProfileDefinition({
    fields: input.fields,
    profile,
    templates: homeFirst,
    recordProjectId: input.recordProjectId,
    categorySlug: input.categorySlug ?? null,
    categorySlugs: input.categorySlugs,
  });
}
