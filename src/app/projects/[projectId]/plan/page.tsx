import { WeaveLibraryPage } from "./WeaveLibraryPage";

export const dynamic = "force-dynamic";

export default async function PlanPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <WeaveLibraryPage projectId={projectId} />;
}
