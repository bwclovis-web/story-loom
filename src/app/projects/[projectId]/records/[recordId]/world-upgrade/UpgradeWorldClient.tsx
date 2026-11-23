"use client";

import { WorldProfileUpgradeReview } from "@/components/world/WorldProfileUpgradeReview";
import type { WorldProfileUpgradePreview } from "@/server/services/worldProfileUpgradeService";
import {
  applyWorldUpgradeAction,
  buildWorldUpgradePackageAction,
  previewWorldUpgradeAction,
} from "./actions";

export function UpgradeWorldClient({
  projectId,
  recordId,
  initial,
}: {
  projectId: string;
  recordId: string;
  initial: WorldProfileUpgradePreview;
}) {
  return (
    <WorldProfileUpgradeReview
      projectId={projectId}
      recordId={recordId}
      initial={initial}
      onPreview={(markdownOverride) => previewWorldUpgradeAction(projectId, recordId, markdownOverride)}
      onApply={(input) => applyWorldUpgradeAction(projectId, recordId, input)}
      onBuildPackage={(input) => buildWorldUpgradePackageAction(projectId, recordId, input)}
    />
  );
}
