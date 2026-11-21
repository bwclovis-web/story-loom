import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { WorldSurfaceNav } from "@/components/world/WorldSurfaceNav";
import { getDb } from "@/server/db";
import { listRecords } from "@/server/services/recordService";
import { SHELL, WORLD } from "@/ui/labels";
import { worldbuildingKindFromFields } from "@/world/worldKinds";
import { NameGenerator } from "./NameGenerator";

export const dynamic = "force-dynamic";

export default async function WorldNamesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const records = await listRecords(getDb(), projectId);
  const languages = records
    .filter((row) => row.type === "worldbuilding" && worldbuildingKindFromFields(row.fields) === "language")
    .map((row) => ({ id: row.id, title: row.title, fields: row.fields }));
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return (
    <>
      <Breadcrumbs
        label={WORLD.breadcrumb}
        items={[
          { href: `${base}/world`, label: SHELL.world },
          { label: WORLD.nameGenerator, current: true },
        ]}
      />
      <PageHeader title={WORLD.nameGenerator} lead={WORLD.nameGeneratorPageLead} />
      <WorldSurfaceNav projectId={projectId} current="names" />
      <NameGenerator projectId={projectId} languages={languages} />
    </>
  );
}