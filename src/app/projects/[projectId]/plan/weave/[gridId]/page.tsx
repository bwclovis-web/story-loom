import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { isLinkableReferenceType, isManuscriptType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { NotFoundError } from "@/server/services/errors";
import { listManuscriptNav, listRecords } from "@/server/services/recordService";
import { getProject, listSeriesBookProjects } from "@/server/services/projectService";
import { getWeaveGrid, listSeriesWeaveBeats } from "@/server/services/weaveService";
import { SHELL, WEAVE, WORLD } from "@/ui/labels";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import { otherDraftRowByRecord } from "@/ui/plotGridPlacement";
import { WeaveCanvas } from "../WeaveCanvas";
import type { PlotGridChapter } from "../WeavePlotGrid";

export const dynamic = "force-dynamic";

export default async function WeaveGridPage({
  params,
}: {
  params: Promise<{ projectId: string; gridId: string }>;
}) {
  const { projectId, gridId } = await params;
  const db = getDb();
  let grid;
  try {
    grid = await getWeaveGrid(db, projectId, gridId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const drafts = await listManuscriptDrafts(db, projectId).catch(() => []);
  const hasDrafts = drafts.length > 0;
  const activeDraftId = resolveWriteDraftId(drafts, await readWriteDraftCookie());
  const [project, records, nav, seriesBeats, seriesBooks] = await Promise.all([
    getProject(db, projectId),
    listRecords(db, projectId),
    listManuscriptNav(db, projectId, { hasDrafts, draftId: activeDraftId }),
    listSeriesWeaveBeats(db, projectId).catch(() => []),
    listSeriesBookProjects(db, projectId),
  ]);
  const draftOptions = drafts.map((d) => ({
    id: d.id,
    kind: d.kind,
    label: d.label,
    completedAt: d.completedAt ? d.completedAt.toISOString() : null,
  }));
  const manuscriptChoices = records
    .filter((r) => isManuscriptType(r.type) && r.type !== "scene_note")
    .map((r) => ({ id: r.id, title: r.title, typeLabel: RECORD_TYPE_LABELS[r.type] }));
  const worldChoices = records
    .filter((r) => isLinkableReferenceType(r.type))
    .map((r) => ({ id: r.id, title: r.title, typeLabel: RECORD_TYPE_LABELS[r.type] }));

  const tree = buildManuscriptTree(nav);
  const manuscriptChapters: PlotGridChapter[] = [];
  let sceneIndex = 0;
  for (const chapter of tree.chapters) {
    if (chapter.scenes.length === 0) {
      sceneIndex += 1;
      manuscriptChapters.push({
        id: chapter.id,
        title: chapter.title,
        rows: [
          {
            id: chapter.id,
            label: chapter.title,
            kind: "chapter",
            indexLabel: String(sceneIndex).padStart(2, "0"),
          },
        ],
      });
    } else {
      manuscriptChapters.push({
        id: chapter.id,
        title: chapter.title,
        rows: chapter.scenes.map((scene) => {
          sceneIndex += 1;
          return {
            id: scene.id,
            label: scene.title,
            kind: "scene" as const,
            indexLabel: String(sceneIndex).padStart(2, "0"),
          };
        }),
      });
    }
  }
  if (tree.unplaced.length) {
    manuscriptChapters.push({
      id: "__unplaced_scenes__",
      title: WEAVE.unplacedRow,
      rows: tree.unplaced.map((scene) => {
        sceneIndex += 1;
        return {
          id: scene.id,
          label: scene.title,
          kind: "scene" as const,
          indexLabel: String(sceneIndex).padStart(2, "0"),
        };
      }),
    });
  }
  const rewriteLinks = await db.rewriteSourceLink.findMany({
    where: { projectId },
    select: { fromRecordId: true, toRecordId: true },
  });
  const visibleRowIds = new Set(manuscriptChapters.flatMap((chapter) => chapter.rows.map((row) => row.id)));
  const otherDraftRowByRecordId = Object.fromEntries(otherDraftRowByRecord(visibleRowIds, rewriteLinks));

  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <Breadcrumbs
        label={WORLD.breadcrumb}
        items={[
          { href: `${base}/plan`, label: SHELL.plan },
          { label: grid.title, current: true },
        ]}
      />
      <WeaveCanvas
        projectId={projectId}
        grid={grid}
        projectTitle={project.title}
        bookName={project.bookName}
        seriesBooks={seriesBooks}
        drafts={draftOptions}
        activeDraftId={activeDraftId}
        planLabel={grid.viewLabel}
        manuscriptChoices={manuscriptChoices}
        manuscriptChapters={manuscriptChapters}
        otherDraftRowByRecordId={otherDraftRowByRecordId}
        worldChoices={worldChoices}
        seriesBeats={seriesBeats}
      />
    </>
  );
}
