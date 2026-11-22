import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { HelpHint } from "@/components/HelpHint";
import { NAV, SCRIVENER_IMPORT } from "@/ui/labels";
import { ScrivenerImportClient } from "./ScrivenerImportClient";

export default async function ImportScrivenerPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <>
      <ProjectPageHeader projectId={projectId} title={NAV.importScrivener} description={SCRIVENER_IMPORT.lead} />
      <p className="muted small">{SCRIVENER_IMPORT.nothingYet}</p>
      <HelpHint anchor="import-scrivener" topic="importing from Scrivener">
        Draft folders become chapters. Nested documents stay as scene breaks inside the chapter. Research becomes research
        notes. Unsupported binder items appear in the import report and are not written.
      </HelpHint>
      <ScrivenerImportClient projectId={projectId} />
    </>
  );
}
