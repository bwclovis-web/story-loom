"use client";

import { CharacterDossierUpgradeReview } from "@/components/world/CharacterDevelopment";
import type { CharacterDossierUpgradePreview } from "@/server/services/characterDossierUpgradeService";
import {
  applyDossierUpgradeAction,
  buildDossierUpgradePackageAction,
  previewDossierUpgradeAction,
} from "./actions";

export function UpgradeDossierClient({
  projectId,
  recordId,
  initial,
}: {
  projectId: string;
  recordId: string;
  initial: CharacterDossierUpgradePreview;
}) {
  return (
    <CharacterDossierUpgradeReview
      projectId={projectId}
      initial={initial}
      importMode
      onPreview={async (markdownOverride) => previewDossierUpgradeAction(projectId, recordId, markdownOverride)}
      onApply={async (input) => applyDossierUpgradeAction(projectId, recordId, input)}
      onBuildPackage={async (input) => buildDossierUpgradePackageAction(projectId, recordId, input)}
    />
  );
}
