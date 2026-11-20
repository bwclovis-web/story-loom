import { WeaveLibraryPage } from "../WeaveLibraryPage";

export const dynamic = "force-dynamic";

/** Older grid index. Same library as `/plan`, so existing links still open the grids. */
export default async function WeaveIndexPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <WeaveLibraryPage projectId={projectId} />;
}
