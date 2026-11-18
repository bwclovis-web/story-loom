import Link from "next/link";
import { notFound } from "next/navigation";
import { isLinkableReferenceType, isManuscriptType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/services/errors";
import { listRecords } from "@/server/services/recordService";
import { getWeaveGrid, listSeriesWeaveBeats } from "@/server/services/weaveService";
import { SHELL, WEAVE } from "@/ui/labels";
import { WeaveCanvas } from "../WeaveCanvas";

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

  const records = await listRecords(db, projectId);
  const manuscriptChoices = records
    .filter((r) => isManuscriptType(r.type) && r.type !== "scene_note")
    .map((r) => ({ id: r.id, title: r.title, typeLabel: RECORD_TYPE_LABELS[r.type] }));
  const worldChoices = records
    .filter((r) => isLinkableReferenceType(r.type))
    .map((r) => ({ id: r.id, title: r.title, typeLabel: RECORD_TYPE_LABELS[r.type] }));
  const seriesBeats = await listSeriesWeaveBeats(db, projectId).catch(() => []);
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
        worldChoices={worldChoices}
        seriesBeats={seriesBeats}
      />
    </>
  );
}
