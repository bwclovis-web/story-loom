import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { ButtonLink } from "@/components/ui/Atoms/Button";
import { getDb } from "@/server/db";
import { listRecords } from "@/server/services/recordService";
import { TAXONOMY_ORGANIZE } from "@/ui/labels";
import { categoryLabel, isWorldType } from "@/ui/world";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
import { worldHubHref } from "@/world/hubDiscovery";
import { BulkOrganizeClient, type OrganizeRecordRow } from "./BulkOrganizeClient";
import { resolveRecordTaxonomy } from "@/world/taxonomy";

export const dynamic = "force-dynamic";

export default async function OrganizeWorldPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  // Local records only. Series-shared references from sibling books are not listed.
  const records = await listRecords(getDb(), projectId);
  const rows: OrganizeRecordRow[] = records
    .filter((record) => isWorldType(record.type))
    .map((record) => {
      const resolved = resolveRecordTaxonomy({ type: record.type, fields: record.fields });
      return {
        id: record.id,
        title: record.title,
        typeLabel: categoryLabel(record.type),
        protected: record.protected,
        primary: resolved.primary,
        inferred: resolved.usedLegacyFallback,
        secondary: resolved.secondary,
        tags: resolved.tags,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

  return (
    <>
      <ProjectPageHeader
        projectId={projectId}
        title={TAXONOMY_ORGANIZE.title}
        description={TAXONOMY_ORGANIZE.lead}
        crumbs={worldSurfaceCrumbs(projectId, "references", TAXONOMY_ORGANIZE.title)}
        actions={
          <ButtonLink href={worldHubHref(projectId)} variant="secondary">
            {TAXONOMY_ORGANIZE.backToHub}
          </ButtonLink>
        }
      />
      <BulkOrganizeClient projectId={projectId} records={rows} />
    </>
  );
}
