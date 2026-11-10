import type { OperationPreview } from "@/server/services/changePackageService";

/*
 * Operations in an assistant proposal that would make content canon. They
 * need the author's explicit confirmation on the Apply form, so a proposal
 * cannot quietly turn proposed facts into approved ones.
 */

export interface CanonChange {
  index: number;
  recordId: string;
  title: string;
  reason: "created_approved" | "promoted" | "approved_content_changed";
}

export const CANON_REASON_TEXT: Record<CanonChange["reason"], string> = {
  created_approved: "would be created as approved (canon)",
  promoted: "would be promoted to approved (canon)",
  approved_content_changed: "is approved (canon) and its content would change",
};

export function canonChanges(operations: readonly OperationPreview[]): CanonChange[] {
  return operations.flatMap((o): CanonChange[] => {
    if (o.statusAfter !== "approved") return [];
    const base = { index: o.index, recordId: o.recordId, title: o.titleAfter };
    if (o.statusBefore === null) return [{ ...base, reason: "created_approved" }];
    if (o.statusBefore !== "approved") return [{ ...base, reason: "promoted" }];
    const contentChanged = o.titleBefore !== o.titleAfter || o.bodyChanged || o.fieldDiffs.length > 0;
    return contentChanged ? [{ ...base, reason: "approved_content_changed" }] : [];
  });
}
