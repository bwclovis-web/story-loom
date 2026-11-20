import { notFound } from "next/navigation";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { findProject } from "@/server/services/projectService";
import { listRecordNav } from "@/server/services/recordService";
import { countOpenReviewItems } from "@/server/services/reviewService";
import { listWeaveGrids } from "@/server/services/weaveService";
import { getSpellingLanguage } from "@/server/spelling";
import { listProjectCoverHashes } from "@/server/services/coverService";
import { manuscriptEyebrow } from "@/ui/library";
import { RECORD_GROUPS } from "@/ui/navigation";
import { WeaveLibrary } from "./WeaveLibrary";

export async function WeaveLibraryPage({ projectId }: { projectId: string }) {
  const db = getDb();
  const [project, grids, nav, spellingLanguage, openReviewItems, coverHashes] = await Promise.all([
    findProject(db, projectId),
    listWeaveGrids(db, projectId),
    listRecordNav(db, projectId),
    getSpellingLanguage(),
    countOpenReviewItems(db, projectId),
    listProjectCoverHashes(db, [projectId]),
  ]);
  if (!project) notFound();
  const coverHash = coverHashes.get(projectId) ?? null;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const references = RECORD_GROUPS.plan.map((type) => ({
    label: RECORD_TYPE_LABELS[type],
    records: nav.filter((record) => record.type === type).map((record) => ({ id: record.id, title: record.title })),
  }));

  return (
    <WeaveLibrary
      projectId={projectId}
      title={project.title}
      eyebrow={manuscriptEyebrow(project.seriesName, project.workspace.name)}
      coverSrc={coverHash ? `${base}/cover?v=${coverHash}` : null}
      grids={grids.map((grid) => ({
        id: grid.id,
        title: grid.title,
        viewKind: grid.viewKind,
        viewLabel: grid.viewLabel,
        beatCount: grid.beatCount,
      }))}
      references={references}
      spellingLanguage={spellingLanguage}
      openReviewItems={openReviewItems}
    />
  );
}
