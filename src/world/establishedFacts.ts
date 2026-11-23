/**
 * Client-safe established-fact kinds, statuses, and view types.
 * Keep this free of server/db imports so client components can use it.
 */

export const EVIDENCE_KINDS = ["planned", "zero_draft", "author_rewrite"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  planned: "Planned material",
  zero_draft: "Zero-draft evidence",
  author_rewrite: "Author-rewrite evidence",
};

export const FACT_STATUSES = ["pending", "accepted", "dismissed"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export function isEvidenceKind(v: string): v is EvidenceKind {
  return (EVIDENCE_KINDS as readonly string[]).includes(v);
}

export function isFactStatus(v: string): v is FactStatus {
  return (FACT_STATUSES as readonly string[]).includes(v);
}

export interface FactEvidenceView {
  id: string;
  sourceRecordId: string;
  sourceTitle: string;
  sourceTypeLabel: string;
  revisionNumber: number;
  passageStart: number;
  passageEnd: number;
  passageExcerpt: string;
  evidenceKind: EvidenceKind;
  evidenceKindLabel: string;
  needsRecheck: boolean;
  createdAt: Date;
}

export interface EstablishedFactView {
  id: string;
  subjectRecordId: string;
  statement: string;
  status: FactStatus;
  evidenceKind: EvidenceKind;
  evidenceKindLabel: string;
  createdAt: Date;
  updatedAt: Date;
  evidence: FactEvidenceView[];
}

export interface KnowledgePassage {
  recordId: string;
  title: string;
  start: number;
  end: number;
  excerpt: string;
  matchedName: string;
}

export interface CharacterKnowledgeCheckResult {
  subjectRecordId: string;
  subjectTitle: string;
  draftId: string | null;
  draftLabel: string | null;
  sceneId: string;
  sceneTitle: string;
  evidenceKind: EvidenceKind;
  passagesChecked: KnowledgePassage[];
  /** Name matches found. The list above keeps the first 40. */
  passagesMatched: number;
  coveredFactIds: string[];
  /** Accepted facts with linked evidence citing this scene (same evidence kind). */
  coveredByEvidence: Array<{ factId: string; statement: string }>;
  /** Accepted facts matched by keyword overlap only (no linked evidence in this scene). */
  coveredByKeywords: Array<{ factId: string; statement: string }>;
  gaps: Array<{ factId: string; statement: string; evidenceKind: EvidenceKind }>;
  nameFormsUsed: string[];
}
