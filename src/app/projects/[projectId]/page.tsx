import { RECORD_TYPES } from "@/domain/recordTypes";
import { GROUP_PAGES, NAV } from "@/ui/labels";
import { RecordListPage } from "./RecordListPage";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <RecordListPage
      projectId={projectId}
      heading={NAV.records}
      lead={GROUP_PAGES.all}
      types={RECORD_TYPES}
      defaultType="character_dossier"
    />
  );
}
