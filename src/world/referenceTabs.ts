/**
 * Reference page workspace tabs. Visible tabs depend on record type;
 * URL uses `?tab=` and legacy hashes still deep-link into the right panel.
 */

import { isLinkableReferenceType, isRecordType } from "@/domain/recordTypes";
import { isWorldProfileRecordType } from "@/domain/worldProfile";
import { keepCanvas } from "@/world/canvasReturn";

export const REFERENCE_TABS = ["document", "profile", "images", "relationships", "established"] as const;
export type ReferenceTab = (typeof REFERENCE_TABS)[number];

export type ReferenceTabVisibility = {
  profile: "world" | "character" | false;
  established: boolean;
};

/** Which optional tabs this record type can show. */
export function referenceTabVisibility(
  type: string,
  options: { hasEstablishedFacts?: boolean } = {},
): ReferenceTabVisibility {
  const profile: ReferenceTabVisibility["profile"] = isWorldProfileRecordType(type)
    ? "world"
    : type === "character_dossier"
      ? "character"
      : false;
  const established =
    isRecordType(type) &&
    isLinkableReferenceType(type) &&
    options.hasEstablishedFacts !== false;
  return { profile, established };
}

/** Ordered tabs for the tablist, omitting unsupported panels. */
export function visibleReferenceTabs(visibility: ReferenceTabVisibility): ReferenceTab[] {
  const tabs: ReferenceTab[] = ["document"];
  if (visibility.profile) tabs.push("profile");
  tabs.push("images", "relationships");
  if (visibility.established) tabs.push("established");
  return tabs;
}

/** Normalize a query value to a known tab, or null when missing/unknown. */
export function parseReferenceTab(raw: string | null | undefined): ReferenceTab | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  return (REFERENCE_TABS as readonly string[]).includes(value) ? (value as ReferenceTab) : null;
}

/**
 * Resolve the active tab from the query and the tabs this record supports.
 * Unknown or unsupported values fall back to document.
 */
export function resolveReferenceTab(
  raw: string | null | undefined,
  visibility: ReferenceTabVisibility,
): ReferenceTab {
  const parsed = parseReferenceTab(raw);
  const visible = visibleReferenceTabs(visibility);
  if (parsed && visible.includes(parsed)) return parsed;
  return "document";
}

/**
 * Map a legacy hash (without `#`) to a workspace tab.
 * Document heading anchors (`doc-…`) stay on the document tab.
 */
export function referenceTabFromHash(hash: string): ReferenceTab | null {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!id) return null;
  if (id === "images") return "images";
  if (id === "world-profile" || id === "character-development") return "profile";
  if (id === "place-relations" || id === "record-relations") return "relationships";
  if (id === "reference-editor" || id.startsWith("doc-")) return "document";
  return null;
}

/** Build a same-record href with `tab` set, preserving edit/canvas and optional hash. */
export function referenceTabHref(
  recordHref: string,
  tab: ReferenceTab,
  options: {
    edit?: boolean;
    canvasPath?: string | null;
    hash?: string;
    /** Extra query keys to keep (e.g. from/to). */
    keepParams?: URLSearchParams | Record<string, string | undefined>;
  } = {},
): string {
  const url = new URL(recordHref, "http://local");
  if (options.edit) url.searchParams.set("edit", "1");
  else url.searchParams.delete("edit");

  if (tab === "document") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);

  if (options.keepParams) {
    const entries =
      options.keepParams instanceof URLSearchParams
        ? [...options.keepParams.entries()]
        : Object.entries(options.keepParams).filter((entry): entry is [string, string] => Boolean(entry[1]));
    for (const [key, value] of entries) {
      if (key === "tab" || key === "edit" || key === "canvas") continue;
      url.searchParams.set(key, value);
    }
  }

  let href = `${url.pathname}${url.search}`;
  if (options.hash) {
    const hash = options.hash.startsWith("#") ? options.hash : `#${options.hash}`;
    href = `${href}${hash}`;
  }
  return keepCanvas(href, options.canvasPath ?? null);
}
