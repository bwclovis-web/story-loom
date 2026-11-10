"use client";

import { RECORD } from "@/ui/labels";

/**
 * The protection tick shown inside a writing tool that cannot change protected
 * text yet. It sets the same unlock as the editor's own tick box, which is the
 * one sent with Save.
 */
export function ProtectionTick({ note, onUnlock, warning }: { note: string; onUnlock: () => void; warning?: boolean }) {
  return (
    <div className="protection-tick small">
      <p className={warning ? "warning" : "muted"}>{note}</p>
      <label className="inline">
        <input type="checkbox" onChange={(e) => e.target.checked && onUnlock()} />
        {RECORD.unlockProtected}
      </label>
    </div>
  );
}
