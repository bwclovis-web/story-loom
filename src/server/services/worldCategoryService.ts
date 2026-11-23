import { isWorldScope, type WorldScope } from "@/domain/assignments";
import { newId } from "@/domain/ids";
import type { JsonValue } from "@/domain/json";
import { normalizeCustomTaxonomySlug } from "@/world/taxonomy";
import type { SeriesHomeRef } from "@/world/seriesHome";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { errorIssue } from "@/domain/issues";
import { listSeriesBookProjects } from "./projectService";

export interface WorldCategoryView {
  id: string;
  projectId: string;
  slug: string;
  label: string;
  description: string;
  parentCategorySlug: string | null;
  worldScope: WorldScope | null;
  home: SeriesHomeRef | null;
}

function missingTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2021";
}

function toView(
  row: {
    id: string;
    projectId: string;
    slug: string;
    label: string;
    description: string;
    parentCategorySlug: string | null;
    worldScope: string | null;
  },
  home: SeriesHomeRef | null = null,
): WorldCategoryView {
  return {
    id: row.id,
    projectId: row.projectId,
    slug: row.slug,
    label: row.label,
    description: row.description,
    parentCategorySlug: row.parentCategorySlug,
    worldScope: isWorldScope(row.worldScope) ? row.worldScope : null,
    home,
  };
}

export async function listWorldCategories(db: DbOrTx, projectId: string): Promise<WorldCategoryView[]> {
  try {
    const rows = await db.worldCategoryDefinition.findMany({
      where: { projectId },
      orderBy: [{ parentCategorySlug: "asc" }, { label: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => toView(row));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

/**
 * Local categories plus sibling series-scoped definitions. Local slugs win;
 * siblings are tagged with home and never overwrite local.
 */
export async function listAvailableWorldCategories(
  db: DbOrTx,
  viewingProjectId: string,
): Promise<WorldCategoryView[]> {
  const local = await listWorldCategories(db, viewingProjectId);
  const localSlugs = new Set(local.map((item) => item.slug));
  const books = await listSeriesBookProjects(db, viewingProjectId);
  const siblings = books.filter((book) => book.id !== viewingProjectId);
  if (!siblings.length) return local;
  try {
    const rows = await db.worldCategoryDefinition.findMany({
      where: {
        projectId: { in: siblings.map((book) => book.id) },
        worldScope: "series",
      },
      orderBy: [{ label: "asc" }, { id: "asc" }],
    });
    const homes = new Map(
      siblings.map((book) => [book.id, { projectId: book.id, title: book.title, bookName: book.bookName }]),
    );
    const shared = rows.flatMap((row) => {
      if (localSlugs.has(row.slug)) return [];
      return [toView(row, homes.get(row.projectId) ?? null)];
    });
    return [...local, ...shared];
  } catch (error) {
    if (missingTable(error)) return local;
    throw error;
  }
}

export async function saveWorldCategory(
  db: Db,
  input: {
    projectId: string;
    slug: string;
    label: string;
    description?: string;
    parentCategorySlug?: string | null;
    worldScope?: WorldScope | null;
    actor?: string;
  },
): Promise<WorldCategoryView> {
  const slug = normalizeCustomTaxonomySlug(input.slug);
  const label = input.label.trim().slice(0, 120);
  if (!slug) throw new MutationRejectedError([errorIssue("INVALID_CHANGE", "Category slug is required.")]);
  if (!label) throw new MutationRejectedError([errorIssue("INVALID_CHANGE", "Category label is required.")]);
  const project = await db.project.findFirst({ where: { id: input.projectId, trashedAt: null }, select: { id: true } });
  if (!project) throw new NotFoundError(`Project ${input.projectId} not found`);
  const parentCategorySlug =
    input.parentCategorySlug === undefined || input.parentCategorySlug === null
      ? null
      : normalizeCustomTaxonomySlug(input.parentCategorySlug);
  const existing = await db.worldCategoryDefinition.findUnique({
    where: { projectId_slug: { projectId: project.id, slug } },
  });
  const saved = existing
    ? await db.worldCategoryDefinition.update({
        where: { id: existing.id },
        data: {
          label,
          description: (input.description ?? existing.description).slice(0, 500),
          parentCategorySlug,
          ...(input.worldScope !== undefined ? { worldScope: input.worldScope } : {}),
        },
      })
    : await db.worldCategoryDefinition.create({
        data: {
          id: newId("wcat"),
          projectId: project.id,
          slug,
          label,
          description: (input.description ?? "").slice(0, 500),
          parentCategorySlug,
          worldScope: input.worldScope ?? null,
        },
      });
  await writeAudit(db, {
    projectId: project.id,
    action: existing ? "world_category.update" : "world_category.create",
    actor: input.actor ?? "author",
    summary: existing ? `Updated custom category "${label}"` : `Created custom category "${label}"`,
    details: {
      categoryId: saved.id,
      slug,
      parentCategorySlug,
      worldScope: saved.worldScope ?? null,
    } satisfies JsonValue,
  });
  return toView(saved);
}

export async function setWorldCategoryScope(
  db: Db,
  input: { projectId: string; slug: string; worldScope: WorldScope | null; actor?: string },
): Promise<WorldCategoryView | null> {
  const slug = normalizeCustomTaxonomySlug(input.slug);
  if (!slug) return null;
  const existing = await db.worldCategoryDefinition.findUnique({
    where: { projectId_slug: { projectId: input.projectId, slug } },
  });
  if (!existing || existing.projectId !== input.projectId) return null;
  const saved = await db.worldCategoryDefinition.update({
    where: { id: existing.id },
    data: { worldScope: input.worldScope },
  });
  await writeAudit(db, {
    projectId: input.projectId,
    action: "world_category.scope",
    actor: input.actor ?? "author",
    summary:
      input.worldScope === "series"
        ? `Shared custom category "${existing.label}" with the series`
        : `Kept custom category "${existing.label}" in this book only`,
    details: { categoryId: existing.id, slug, worldScope: input.worldScope },
  });
  return toView(saved);
}

export async function deleteWorldCategory(
  db: Db,
  input: { projectId: string; slug: string; actor?: string },
): Promise<void> {
  const slug = normalizeCustomTaxonomySlug(input.slug);
  if (!slug) return;
  const existing = await db.worldCategoryDefinition.findUnique({
    where: { projectId_slug: { projectId: input.projectId, slug } },
  });
  if (!existing || existing.projectId !== input.projectId) return;
  await db.worldCategoryDefinition.delete({ where: { id: existing.id } });
  await writeAudit(db, {
    projectId: input.projectId,
    action: "world_category.delete",
    actor: input.actor ?? "author",
    summary: `Removed custom category "${existing.label}"`,
    details: { categoryId: existing.id, slug },
  });
}
