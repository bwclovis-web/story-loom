import Link from "next/link";
import { WorldToolHeader } from "@/components/world/WorldToolHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { getDb } from "@/server/db";
import { previewProjectDossierUpgrades } from "@/server/services/characterDossierUpgradeService";
import { CHARACTER_DOSSIER_UPGRADE } from "@/ui/labels";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";

export const dynamic = "force-dynamic";

export default async function ProjectDossierUpgradePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const summary = await previewProjectDossierUpgrades(getDb(), projectId);
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <WorldToolHeader
        projectId={projectId}
        items={worldSurfaceCrumbs(projectId, "development", CHARACTER_DOSSIER_UPGRADE.seriesHeading)}
        title={CHARACTER_DOSSIER_UPGRADE.seriesHeading}
        lead={CHARACTER_DOSSIER_UPGRADE.seriesLead}
      />
      {summary.dossiers.length === 0 ? (
        <EmptyState>{CHARACTER_DOSSIER_UPGRADE.noDossiers}</EmptyState>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Character</th>
              <th>Items</th>
              <th>Needs review</th>
              <th>Unclassified</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {summary.dossiers.map((row) => (
              <tr key={row.recordId}>
                <td>{row.title}</td>
                <td>{CHARACTER_DOSSIER_UPGRADE.itemsReady(row.itemCount)}</td>
                <td>{row.needsReview}</td>
                <td>{row.unclassified}</td>
                <td>{row.alreadyMigrated ? CHARACTER_DOSSIER_UPGRADE.alreadyMigrated : row.hasProfile ? "Profile present" : "Markdown only"}</td>
                <td>
                  <Link href={`${base}/records/${encodeURIComponent(row.recordId)}/upgrade`}>
                    {CHARACTER_DOSSIER_UPGRADE.reviewLink}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
