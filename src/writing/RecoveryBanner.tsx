"use client";

import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Atoms/Button";
import { WRITE } from "@/ui/labels";
import type { RecoveryDraft } from "@/writing/localRecovery";

export function RecoveryBanner({
  pending,
  onRestore,
  onDiscard,
}: {
  pending: RecoveryDraft | null;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  if (!pending) return null;
  return (
    <Banner tone="info">
      <p>{WRITE.recoverHeading}</p>
      <p className="small">{WRITE.recoverNote}</p>
      <div className="row">
        <Button type="button" onClick={onRestore}>
          {WRITE.recoverRestore}
        </Button>
        <Button type="button" variant="secondary" onClick={onDiscard}>
          {WRITE.recoverDiscard}
        </Button>
      </div>
    </Banner>
  );
}
