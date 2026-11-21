import { notFound } from "next/navigation";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { getDb } from "@/server/db";
import { getBoard } from "@/server/services/boardService";
import { NotFoundError } from "@/server/services/errors";
import { listRecordImages } from "@/server/services/imageService";
import { listRecords } from "@/server/services/recordService";
import { isLinkableReferenceType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { isWorldType } from "@/ui/world";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
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

  const records = (await listRecords(db, projectId)).filter(
    (r) => isWorldType(r.type) || isLinkableReferenceType(r.type),
  );
  const images: Array<{ id: string; recordId: string; recordTitle: string; name: string; altText: string }> = [];
  for (const r of records) {
    const imgs = await listRecordImages(db, projectId, r.id);
    for (const img of imgs ?? []) {
      images.push({
        id: img.id,
        recordId: r.id,
        recordTitle: r.title,
        name: img.name,
        altText: img.altText,
      });
    }
  }

  return (
    <>
      <ProjectPageHeader
        projectId={projectId}
        title={board.title}
        crumbs={worldSurfaceCrumbs(projectId, "boards", board.title)}
      />
      <BoardCanvas
        projectId={projectId}
        board={board}
        records={records.map((r) => ({
          id: r.id,
          title: r.title,
          typeLabel: RECORD_TYPE_LABELS[r.type],
        }))}
        images={images}
        initialCardId={query.card ?? null}
      />
    </>
  );
}
