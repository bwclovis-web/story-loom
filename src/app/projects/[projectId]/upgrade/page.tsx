import { HelpHint } from "@/components/HelpHint";
import { getDb } from "@/server/db";
import { getAssignmentSnapshot } from "@/server/services/assignmentService";
import { NAV, UPGRADE } from "@/ui/labels";
import { UpgradeClient } from "./UpgradeClient";

export default async function UpgradeProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const initial = await getAssignmentSnapshot(getDb(), projectId);
  return (
    <>
      <h1>{NAV.upgradeProject}</h1>
      <p className="page-lead">{UPGRADE.lead}</p>
      <HelpHint anchor="upgrade-project" topic="upgrading a project">
        Assignments are optional metadata. Applying them does not change chapter text, revisions, images or links.
        Preview first; if the project changes, preview again before applying.
      </HelpHint>
      <UpgradeClient projectId={projectId} initial={initial} />
    </>
  );
}
