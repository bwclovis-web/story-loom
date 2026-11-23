/**
 * Client-safe Story Health rollup. The Continuity Ledger service builds the
 * items; this module only classifies a list the caller already has.
 */

export type ContinuityKind =
  | "unresolved"
  | "open_question"
  | "fact"
  | "story_evidence"
  | "comment"
  | "review"
  | "draft_in_canon"
  | "missing_ref"
  | "timeline_order"
  | "timeline_cycle"
  | "dangling_weave"
  | "continuity_note"
  | "character_state_conflict"
  | "character_knowledge"
  | "character_limitation"
  | "forgotten_arc"
  | "character_identity"
  | "world_contradiction";

export type ContinuityCategory = "bible" | "manuscript" | "timeline" | "weave" | "stale";
export type ContinuitySeverity = "info" | "warn" | "error";
export type ContinuitySuppressReason = "intentional" | "resolved" | "ignored";

export interface ContinuityItem {
  key: string;
  kind: ContinuityKind;
  title: string;
  detail: string;
  href: string;
  category: ContinuityCategory;
  severity: ContinuitySeverity;
  recordId: string | null;
  suppressed: boolean;
  suppressReason: ContinuitySuppressReason | null;
  evidence?: string;
  applicableCanon?: string;
  storyLocation?: string;
  explanation?: string;
  suggestion?: string;
  /** Secondary link to the world record when kind is world_contradiction. */
  worldHref?: string;
  needsRecheck?: boolean;
}

export type StoryHealthStatus = "healthy" | "attention" | "critical";

export interface StoryHealthSummary {
  openCount: number;
  suppressedCount: number;
  bySeverity: Record<ContinuitySeverity, number>;
  byCategory: Record<ContinuityCategory, number>;
  affectedRecordCount: number;
  next: ContinuityItem | null;
  status: StoryHealthStatus;
}

const HEALTH_KIND_ORDER: ContinuityKind[] = [
  "timeline_cycle",
  "draft_in_canon",
  "dangling_weave",
  "timeline_order",
  "character_state_conflict",
  "world_contradiction",
  "missing_ref",
  "fact",
  "story_evidence",
  "unresolved",
  "continuity_note",
  "character_knowledge",
  "character_limitation",
  "forgotten_arc",
  "character_identity",
  "open_question",
  "comment",
  "review",
];

const SEVERITY_RANK: Record<ContinuitySeverity, number> = { error: 0, warn: 1, info: 2 };

/** Pure Story Health rollup. Does not read or write the database. */
export function summarizeStoryHealth(items: readonly ContinuityItem[]): StoryHealthSummary {
  const open = items.filter((item) => !item.suppressed);
  const suppressedCount = items.length - open.length;
  const bySeverity: Record<ContinuitySeverity, number> = { error: 0, warn: 0, info: 0 };
  const byCategory: Record<ContinuityCategory, number> = {
    bible: 0,
    manuscript: 0,
    timeline: 0,
    weave: 0,
    stale: 0,
  };
  const affected = new Set<string>();
  for (const item of open) {
    bySeverity[item.severity] += 1;
    byCategory[item.category] += 1;
    if (item.recordId) affected.add(item.recordId);
  }
  const kindRank = new Map(HEALTH_KIND_ORDER.map((kind, index) => [kind, index]));
  const next =
    [...open].sort((a, b) => {
      const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (severity !== 0) return severity;
      return (kindRank.get(a.kind) ?? 999) - (kindRank.get(b.kind) ?? 999);
    })[0] ?? null;
  const status: StoryHealthStatus =
    bySeverity.error > 0 ? "critical" : open.length > 0 ? "attention" : "healthy";
  return {
    openCount: open.length,
    suppressedCount,
    bySeverity,
    byCategory,
    affectedRecordCount: affected.size,
    next,
    status,
  };
}
