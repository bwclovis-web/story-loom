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

/** Empty / whitespace-only names are stored as null (unassigned). */
export function normalizeOptionalName(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : null;
}
