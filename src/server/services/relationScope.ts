import {
  isRelationScope,
  normalizeRelationScope,
  type RelationScope,
} from "@/domain/assignments";
import { errorIssue } from "@/domain/issues";
import type { DbOrTx } from "../db";
import { MutationRejectedError } from "./errors";
import { listSeriesBookProjects } from "./projectService";
import { resolveAvailableReference, type AvailableReference } from "./seriesBibleService";

export type { RelationScope };
export { isRelationScope, normalizeRelationScope };

export async function resolveRelationEndpoint(
  db: DbOrTx,
  viewingProjectId: string,
  recordId: string,
): Promise<AvailableReference | null> {
  return resolveAvailableReference(db, viewingProjectId, recordId);
}

function rejected(message: string, recordId?: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message, recordId ? { recordId } : {})]);
}

/**
 * Series scope is allowed only when the viewing book is in a named series and
 * both endpoints are live series-scoped World references in that series.
 */
export async function resolveWritableRelationScope(
  db: DbOrTx,
  viewingProjectId: string,
  from: AvailableReference,
  to: AvailableReference,
  requested: RelationScope | string | null | undefined,
): Promise<RelationScope> {
  const scope = normalizeRelationScope(requested);
  if (scope === "book") return "book";
  const books = await listSeriesBookProjects(db, viewingProjectId);
  if (!books.length) {
    throw rejected("Series-scoped relationships need a named series on this book.");
  }
  if (from.record.worldScope !== "series" || to.record.worldScope !== "series") {
    throw rejected("Series-scoped relationships need both ends shared with the whole series.");
  }
  return "series";
}

/** Project ids whose book-local rows are visible in this book, plus series siblings for series rows. */
export async function visibleRelationProjectIds(
  db: DbOrTx,
  viewingProjectId: string,
): Promise<{ localId: string; seriesIds: string[] }> {
  const books = await listSeriesBookProjects(db, viewingProjectId);
  return {
    localId: viewingProjectId,
    seriesIds: books.map((book) => book.id),
  };
}

/**
 * Prisma where-clause fragment: book-scoped rows owned by the viewing project,
 * plus series-scoped rows owned by any live sibling in the same series.
 */
export async function relationVisibilityWhere(db: DbOrTx, viewingProjectId: string) {
  const { localId, seriesIds } = await visibleRelationProjectIds(db, viewingProjectId);
  if (seriesIds.length <= 1) {
    return { projectId: localId };
  }
  return {
    OR: [
      { projectId: localId, scope: { in: ["book", "series"] } },
      { projectId: { in: seriesIds.filter((id) => id !== localId) }, scope: "series" },
    ],
  };
}
