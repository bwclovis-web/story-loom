import { WorldToolHeader } from "@/components/world/WorldToolHeader";
import { getDb } from "@/server/db";
import { listRecords } from "@/server/services/recordService";
import { WORLD } from "@/ui/labels";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
import { worldbuildingKindFromFields } from "@/world/worldKinds";
import { NameGenerator } from "./NameGenerator";

export const dynamic = "force-dynamic";

export default async function WorldNamesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const records = await listRecords(getDb(), projectId);
  const languages = records
    .filter((row) => row.type === "worldbuilding" && worldbuildingKindFromFields(row.fields) === "language")
    .map((row) => ({ id: row.id, title: row.title, fields: row.fields }));
  return (
    <>
      <WorldToolHeader
        items={worldSurfaceCrumbs(projectId, "names")}
        title={WORLD.nameGenerator}
        lead={WORLD.nameGeneratorPageLead}
      />
      <NameGenerator projectId={projectId} languages={languages} />
    </>
  );
}