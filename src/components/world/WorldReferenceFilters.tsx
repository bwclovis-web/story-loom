import Link from "next/link";
import { WORLD } from "@/ui/labels";
import { isWorldKindKey, WORLD_KIND_KEYS, referenceTemplate } from "@/world/referenceTemplates";
import {
  WORLDBUILDING_KIND_OTHER,
  WORLDBUILDING_KIND_UNSET,
  type WorldbuildingKindFilter,
} from "@/world/worldKinds";
import {
  WORLD_CATEGORY_LABELS,
  WORLD_TYPES,
  worldHref,
  type WorldCounts,
  type WorldType,
} from "@/ui/world";

/**
 * Document-type and optional worldbuilding-kind filters for the References hub.
 * Each control is a link. Following one only changes the list; it never writes a kind.
 */
export function WorldReferenceFilters({
  projectId,
  type,
  kind,
  searching,
  listing = false,
  counts,
}: {
  projectId: string;
  type: WorldType | null;
  kind: WorldbuildingKindFilter | null;
  searching: boolean;
  /** True on the full reference table (`?list=1`), which is not the unfiltered hub. */
  listing?: boolean;
  counts: WorldCounts;
}) {
  return (
    <div className="world-reference-filters">
      <nav aria-label={WORLD.documentType}>
        <ul className="world-filter-list">
          <li>
            <Link
              href={worldHref(projectId)}
              aria-current={!searching && !type && !listing ? "page" : undefined}
            >
              {WORLD.allDocumentTypes}
              <span className="nav-count">{counts.all}</span>
            </Link>
          </li>
          {WORLD_TYPES.map((documentType) => {
            const selected = type === documentType;
            const exact = selected && !kind && !searching;
            const nested = selected && (!!kind || searching);
            return (
              <li key={documentType}>
                <Link
                  href={worldHref(projectId, { type: documentType })}
                  aria-current={exact ? "page" : nested ? "true" : undefined}
                >
                  {WORLD_CATEGORY_LABELS[documentType]}
                  <span className="nav-count">{counts.byType[documentType]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** Compact kind menu. Choosing a kind only changes the list. */
export function WorldKindBrowse({
  projectId,
  type,
  kind,
  searching,
  kindCounts,
}: {
  projectId: string;
  type: WorldType | null;
  kind: WorldbuildingKindFilter | null;
  searching: boolean;
  kindCounts: Record<WorldbuildingKindFilter, number>;
}) {
  const current =
    kind && isWorldKindKey(kind)
      ? referenceTemplate(kind).label
      : kind === WORLDBUILDING_KIND_OTHER
        ? WORLD.worldKindOther
        : kind === WORLDBUILDING_KIND_UNSET
          ? WORLD.worldKindUnset
          : null;
  return (
    <details className="world-kind-browse">
      <summary>
        {WORLD.browseKinds}
        {current ? <span className="muted"> — {current}</span> : null}
      </summary>
      <ul className="world-filter-list">
        <li>
          <Link
            href={worldHref(projectId, { type: "worldbuilding" })}
            aria-current={!searching && type === "worldbuilding" && !kind ? "page" : undefined}
          >
            {WORLD.allKinds}
          </Link>
        </li>
        {WORLD_KIND_KEYS.map((key) => (
          <li key={key}>
            <Link
              href={worldHref(projectId, { type: "worldbuilding", kind: key })}
              aria-current={!searching && kind === key ? "page" : undefined}
            >
              {referenceTemplate(key).label}
              <span className="nav-count">{kindCounts[key]}</span>
            </Link>
          </li>
        ))}
        <li>
          <Link
            href={worldHref(projectId, { type: "worldbuilding", kind: WORLDBUILDING_KIND_OTHER })}
            aria-current={!searching && kind === WORLDBUILDING_KIND_OTHER ? "page" : undefined}
          >
            {WORLD.worldKindOther}
            <span className="nav-count">{kindCounts[WORLDBUILDING_KIND_OTHER]}</span>
          </Link>
        </li>
        <li>
          <Link
            href={worldHref(projectId, { type: "worldbuilding", kind: WORLDBUILDING_KIND_UNSET })}
            aria-current={!searching && kind === WORLDBUILDING_KIND_UNSET ? "page" : undefined}
          >
            {WORLD.worldKindUnset}
            <span className="nav-count">{kindCounts[WORLDBUILDING_KIND_UNSET]}</span>
          </Link>
        </li>
      </ul>
      <p className="small muted world-filter-note">{WORLD.categoryNote}</p>
    </details>
  );
}

