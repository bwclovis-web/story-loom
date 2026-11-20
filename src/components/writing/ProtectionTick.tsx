"use client";

import { WRITE } from "@/ui/labels";

/**
 * The same unlock as Enable editing on the manuscript protection row. Checking
 * it sets that control, which is the one sent with Save.
 */
export function ProtectionTick({ note, onUnlock, warning }: { note: string; onUnlock: () => void; warning?: boolean }) {
  return (
    <div className="protection-tick small">
      <p className={warning ? "warning" : "muted"}>{note}</p>
      <label className="inline">
        <input type="checkbox" onChange={(e) => e.target.checked && onUnlock()} />
        {WRITE.enableEditing}
      </label>
    </div>
  );
}
