/*
 * Optional Series, Book and Draft assignments. All fields are structural
 * metadata (like parentRecordId and position): not revisioned content.
 * Null / absent means the project opens exactly as it did before.
 */

export const DRAFT_KINDS = ["zero_draft", "author_manuscript"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const DRAFT_KIND_LABELS: Record<DraftKind, string> = {
  zero_draft: "Zero draft",
  author_manuscript: "Author manuscript",
};

export function isDraftKind(value: string | null | undefined): value is DraftKind {
  return !!value && (DRAFT_KINDS as readonly string[]).includes(value);
}

/** Default display labels when creating a ManuscriptDraft row. */
export function defaultDraftLabel(kind: DraftKind): string {
  return DRAFT_KIND_LABELS[kind];
}

/** Where a World reference applies: this book, or the whole series. */
export const WORLD_SCOPES = ["book", "series"] as const;
export type WorldScope = (typeof WORLD_SCOPES)[number];

export const WORLD_SCOPE_LABELS: Record<WorldScope, string> = {
  book: "This book",
  series: "Whole series",
};

export function isWorldScope(value: string | null | undefined): value is WorldScope {
  return !!value && (WORLD_SCOPES as readonly string[]).includes(value);
}

/**
 * Visibility of an explicit PlaceRelation / RecordRelation.
 * book = only in the owning project; series = across sibling books when both
 * endpoints are series-scoped World references in that series.
 */
export const RELATION_SCOPES = ["book", "series"] as const;
export type RelationScope = (typeof RELATION_SCOPES)[number];

export const RELATION_SCOPE_LABELS: Record<RelationScope, string> = {
  book: "This book only",
  series: "Whole series",
};

export function isRelationScope(value: string | null | undefined): value is RelationScope {
  return !!value && (RELATION_SCOPES as readonly string[]).includes(value);
}

export function normalizeRelationScope(value: string | null | undefined): RelationScope {
  return isRelationScope(value) ? value : "book";
}

/** Empty / whitespace-only names are stored as null (unassigned). */
export function normalizeOptionalName(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : null;
}
