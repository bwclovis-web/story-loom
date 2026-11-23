import { notFound } from "next/navigation";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { ProjectOnboarding } from "@/components/shell/ProjectOnboarding";
import { getDb } from "@/server/db";
import { getBoard } from "@/server/services/boardService";
import { NotFoundError } from "@/server/services/errors";
import { listRecordImages } from "@/server/services/imageService";
import { listAvailableReferences } from "@/server/services/seriesBibleService";
import { listAvailableWorldCategories } from "@/server/services/worldCategoryService";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { SERIES } from "@/ui/labels";
import { seriesBookLabel } from "@/world/seriesHome";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
import { BoardCanvas } from "../BoardCanvas";

export const dynamic = "force-dynamic";

export default async function WorldBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; boardId: string }>;
  searchParams: Promise<{ card?: string }>;
}) {
  const { projectId, boardId } = await params;
  const query = await searchParams;
  const db = getDb();
  let board;
  try {
    board = await getBoard(db, projectId, boardId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [available, availableCategories] = await Promise.all([
    listAvailableReferences(db, projectId, { linkableOnly: true }),
    listAvailableWorldCategories(db, projectId),
  ]);
  const customCategories: CustomTaxonomyCategoryOption[] = availableCategories.map((row) => ({
    slug: row.slug,
    label: row.label,
    description: row.description,
    parentCategorySlug: row.parentCategorySlug,
    shared: Boolean(row.home),
    homeLabel: row.home ? row.home.bookName?.trim() || row.home.title : null,
  }));
  const images: Array<{
    id: string;
    recordId: string;
    recordTitle: string;
    name: string;
    altText: string;
    homeLabel: string | null;
  }> = [];
  for (const entry of available) {
    const homeProjectId = entry.home?.projectId ?? projectId;
    const imgs = await listRecordImages(db, homeProjectId, entry.record.id);
    const homeLabel = entry.home ? SERIES.homeBadge(seriesBookLabel(entry.home)) : null;
    for (const img of imgs ?? []) {
      images.push({
        id: img.id,
        recordId: entry.record.id,
        recordTitle: entry.record.title,
        name: img.name,
        altText: img.altText,
        homeLabel,
      });
    }
  }

  return (
    <div className="visual-workspace">
      <ProjectPageHeader
        projectId={projectId}
        title={board.title}
        crumbs={worldSurfaceCrumbs(projectId, "boards", board.title)}
        gettingStarted={<ProjectOnboarding projectId={projectId} quiet marked />}
      />
      <BoardCanvas
        projectId={projectId}
        board={board}
        records={available.map((entry) => ({
          id: entry.record.id,
          title: entry.record.title,
          typeLabel: RECORD_TYPE_LABELS[entry.record.type],
          homeLabel: entry.home ? SERIES.homeBadge(seriesBookLabel(entry.home)) : null,
          worldScope: entry.worldScope,
          taxonomy: entry.taxonomy,
        }))}
        customCategories={customCategories}
        images={images}
        initialCardId={query.card ?? null}
      />
    </div>
  );
}
