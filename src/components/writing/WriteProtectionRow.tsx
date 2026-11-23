"use client";

import { Lock } from "lucide-react";
import type { DraftOption } from "@/components/drafts/DraftControls";
import { buttonVariants } from "@/components/ui/Atoms/Button";
import { DRAFT, WORLD, WRITE } from "@/ui/labels";
import { cn } from "@/ui/cn";

function draftName(drafts: readonly DraftOption[], activeDraftId: string | null): string {
  if (drafts.length === 0) return DRAFT.legacyScope;
  return drafts.find((draft) => draft.id === activeDraftId)?.label ?? DRAFT.selectDraft;
}

/**
 * Draft and protection, one row high in every layout. Enable editing is the
 * confirmation sent with Save (`unlockProtected`).
 */
export function WriteProtectionRow({
  drafts,
  activeDraftId,
  isProtected,
  unlocked,
  onUnlocked,
}: {
  drafts: readonly DraftOption[];
  activeDraftId: string | null;
  isProtected: boolean;
  unlocked: boolean;
  onUnlocked: (on: boolean) => void;
}) {
  return (
    <div className="protect-row">
      <div className="protect-row-facts">
        <span className="draft-pill">{draftName(drafts, activeDraftId)}</span>
        {isProtected ? (
          <span className="protect-state">
            <Lock aria-hidden="true" className="icon" size={14} strokeWidth={1.75} />
            {unlocked ? WRITE.protectedEditing : WRITE.protectedReadOnly}
          </span>
        ) : (
          <span className="protect-state">{WORLD.notProtected}</span>
        )}
      </div>
      {isProtected ? (
        <label className={cn(buttonVariants({ variant: "brass", size: "sm" }), unlocked && "is-on")}>
          <input
            type="checkbox"
            className="sr-only"
            name="unlockProtected"
            checked={unlocked}
            onChange={(e) => onUnlocked(e.target.checked)}
          />
          {unlocked ? WRITE.editingEnabled : WRITE.enableEditing}
        </label>
      ) : (
        <span className="protect-row-spacer" aria-hidden="true" />
      )}
    </div>
  );
}
