import Link from "next/link";
import { notFound } from "next/navigation";
import { isLinkableReferenceType, isManuscriptType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { NotFoundError } from "@/server/services/errors";
import { listManuscriptNav, listRecords } from "@/server/services/recordService";
import { getWeaveGrid, listSeriesWeaveBeats } from "@/server/services/weaveService";
import { SHELL, WEAVE } from "@/ui/labels";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import { WeaveCanvas } from "../WeaveCanvas";
import type { PlotGridRow } from "../WeavePlotGrid";

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
  const [records, nav, seriesBeats] = await Promise.all([
    listRecords(db, projectId),
    listManuscriptNav(db, projectId, { hasDrafts, draftId: activeDraftId }),
    listSeriesWeaveBeats(db, projectId).catch(() => []),
  ]);
  const manuscriptChoices = records
    .filter((r) => isManuscriptType(r.type) && r.type !== "scene_note")
    .map((r) => ({ id: r.id, title: r.title, typeLabel: RECORD_TYPE_LABELS[r.type] }));
  const worldChoices = records
    .filter((r) => isLinkableReferenceType(r.type))
    .map((r) => ({ id: r.id, title: r.title, typeLabel: RECORD_TYPE_LABELS[r.type] }));

  const tree = buildManuscriptTree(nav);
  const manuscriptRows: PlotGridRow[] = [];
  for (const chapter of tree.chapters) {
    if (chapter.scenes.length === 0) {
      manuscriptRows.push({ id: chapter.id, label: chapter.title, kind: "chapter" });
    } else {
      for (const scene of chapter.scenes) {
        manuscriptRows.push({
          id: scene.id,
          label: scene.title,
          kind: "scene",
          chapterTitle: chapter.title,
        });
      }
    }
  }
  for (const scene of tree.unplaced) {
    manuscriptRows.push({ id: scene.id, label: scene.title, kind: "scene" });
  }
  manuscriptRows.push({ id: null, label: WEAVE.unplacedRow, kind: "unplaced" });

  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumbs">
        <ol>
          <li>
            <Link href={`${base}/plan`}>{SHELL.plan}</Link>
          </li>
          <li>
            <Link href={`${base}/plan/weave`}>{WEAVE.heading}</Link>
          </li>
          <li>
            <span aria-current="page">{grid.title}</span>
          </li>
        </ol>
      </nav>
      <WeaveCanvas
        projectId={projectId}
        grid={grid}
        manuscriptChoices={manuscriptChoices}
        manuscriptRows={manuscriptRows}
        worldChoices={worldChoices}
        seriesBeats={seriesBeats}
      />
    </>
  );
}
