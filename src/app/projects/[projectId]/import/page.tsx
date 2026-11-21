import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { HelpHint } from "@/components/HelpHint";
import { NAV } from "@/ui/labels";
import { ImportClient } from "./ImportClient";

export default async function ImportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <>
      <ProjectPageHeader projectId={projectId} title={NAV.importPackage} />
      <p className="muted small">
        Paste or upload a <code>wordly.change-package</code> JSON file. It is validated in full and previewed before
        anything changes. Applying is all-or-nothing, and a package ID can only be applied once.
      </p>
      <HelpHint anchor="change-package-import" topic="change packages">
        A change package is a file of proposed updates, usually prepared by ChatGPT. Nothing changes until you apply it.
      </HelpHint>
      <ImportClient projectId={projectId} />
    </>
  );
}
