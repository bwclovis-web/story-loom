import { notFound } from "next/navigation";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { getDb } from "@/server/db";
import { previewCharacterDossierUpgrade } from "@/server/services/characterDossierUpgradeService";
import { getRecord } from "@/server/services/recordService";
import { CHARACTER_DOSSIER_UPGRADE } from "@/ui/labels";
import { UpgradeDossierClient } from "./UpgradeDossierClient";

export const dynamic = "force-dynamic";

export default async function UpgradeDossierPage({
  params,
}: {
  params: Promise<{ projectId: string; recordId: string }>;
}) {
  const { projectId, recordId } = await params;
  const db = getDb();
  let record;
  try {
    record = await getRecord(db, projectId, recordId);
  } catch {
    notFound();
  }
  if (record.type !== "character_dossier") notFound();

  const preview = await previewCharacterDossierUpgrade(db, projectId, recordId);

  return (
    <>
      <ProjectPageHeader
        projectId={projectId}
        title={CHARACTER_DOSSIER_UPGRADE.heading}
        crumbs={[
          { href: `/projects/${encodeURIComponent(projectId)}/world`, label: "World" },
          {
            href: `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`,
            label: record.title,
          },
          { label: CHARACTER_DOSSIER_UPGRADE.heading, current: true },
        ]}
      />
      <UpgradeDossierClient projectId={projectId} recordId={recordId} initial={preview} />
    </>
  );
}
