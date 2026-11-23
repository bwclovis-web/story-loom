import { notFound } from "next/navigation";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { getDb } from "@/server/db";
import { isWorldProfileRecordType } from "@/domain/worldProfile";
import { previewWorldProfileUpgrade } from "@/server/services/worldProfileUpgradeService";
import { getRecord } from "@/server/services/recordService";
import { getSeriesSharedRecord } from "@/server/services/seriesBibleService";
import { WORLD_PROFILE_UPGRADE } from "@/ui/labels";
import { UpgradeWorldClient } from "./UpgradeWorldClient";

export const dynamic = "force-dynamic";

export default async function UpgradeWorldProfilePage({
  params,
}: {
  params: Promise<{ projectId: string; recordId: string }>;
}) {
  const { projectId, recordId } = await params;
  const db = getDb();
  let title = "";
  try {
    const record = await getRecord(db, projectId, recordId);
    if (!isWorldProfileRecordType(record.type)) notFound();
    title = record.title;
  } catch {
    const shared = await getSeriesSharedRecord(db, projectId, recordId);
    if (!shared || !isWorldProfileRecordType(shared.record.type)) notFound();
    title = shared.record.title;
  }

  const preview = await previewWorldProfileUpgrade(db, projectId, recordId);

  return (
    <>
      <ProjectPageHeader
        projectId={projectId}
        title={WORLD_PROFILE_UPGRADE.heading}
        crumbs={[
          { href: `/projects/${encodeURIComponent(projectId)}/world`, label: "World" },
          {
            href: `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`,
            label: title,
          },
          { label: WORLD_PROFILE_UPGRADE.heading, current: true },
        ]}
      />
      <UpgradeWorldClient projectId={projectId} recordId={recordId} initial={preview} />
    </>
  );
}
