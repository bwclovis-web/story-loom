import { cookies } from "next/headers";
import { parseWriteDraftPreference, WRITE_DRAFT_COOKIE } from "@/components/shell/preferences";
import type { ManuscriptDraftView, ProjectDraftDefaults } from "@/server/services/draftService";

/** Resolve the Write draft from the browser cookie against drafts that exist. */
export function resolveWriteDraftId(
  drafts: readonly ManuscriptDraftView[],
  cookieValue: string | undefined,
): string | null {
  if (drafts.length === 0) return null;
  const preferred = parseWriteDraftPreference(cookieValue);
  if (preferred && drafts.some((d) => d.id === preferred)) return preferred;
  const author = drafts.find((d) => d.kind === "author_manuscript");
  const zero = drafts.find((d) => d.kind === "zero_draft");
  return author?.id ?? zero?.id ?? drafts[0]?.id ?? null;
}

/** Reading visit draft: explicit query, else project default, else first available. */
export function resolveReadingDraftId(
  drafts: readonly ManuscriptDraftView[],
  defaults: ProjectDraftDefaults,
  queryDraftId: string | null | undefined,
): string | null {
  if (drafts.length === 0) return null;
  if (queryDraftId && drafts.some((d) => d.id === queryDraftId)) return queryDraftId;
  if (defaults.defaultReadingDraftId && drafts.some((d) => d.id === defaults.defaultReadingDraftId)) {
    return defaults.defaultReadingDraftId;
  }
  return null;
}

/** Export visit draft: explicit query, else project default, else unset. */
export function resolveExportDraftId(
  drafts: readonly ManuscriptDraftView[],
  defaults: ProjectDraftDefaults,
  queryDraftId: string | null | undefined,
): string | null {
  if (drafts.length === 0) return null;
  if (queryDraftId && drafts.some((d) => d.id === queryDraftId)) return queryDraftId;
  if (defaults.defaultExportDraftId && drafts.some((d) => d.id === defaults.defaultExportDraftId)) {
    return defaults.defaultExportDraftId;
  }
  return null;
}

export async function readWriteDraftCookie(): Promise<string | undefined> {
  return (await cookies()).get(WRITE_DRAFT_COOKIE)?.value;
}
