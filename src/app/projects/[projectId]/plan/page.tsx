import { GROUP_PAGES, SHELL } from "@/ui/labels";
import { RECORD_GROUPS } from "@/ui/navigation";
import { RecordListPage } from "../RecordListPage";

export const dynamic = "force-dynamic";

export default async function PlanPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <RecordListPage
      projectId={projectId}
      heading={SHELL.plan}
      lead={GROUP_PAGES.plan}
      types={RECORD_GROUPS.plan}
      defaultType="chapter_outline"
    />
  );
}
