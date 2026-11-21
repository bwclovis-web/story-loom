"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";
import { WORLD } from "@/ui/labels";
import { parseProjectPath, type RecordNavEntry } from "@/ui/navigation";
import { isWorldType } from "@/ui/world";
import {
  matchWorldDestination,
  worldDestinationHref,
  WORLD_DESTINATION_GROUPS,
  worldDestinationsInGroup,
} from "@/ui/worldDestinations";

/**
 * Persistent World surfaces. Titles, document types, kinds, and individual
 * maps or boards stay on their own pages — this list is the same on every
 * World tool.
 */
export function WorldNav({
  projectId,
  records,
}: {
  projectId: string;
  records: RecordNavEntry[];
}) {
  const idPrefix = useId();
  const pathname = usePathname() ?? "";
  const parsed = parseProjectPath(pathname);
  const recordId = parsed?.rest[0] === "records" ? (parsed.rest[1] ?? null) : null;
  const current = recordId ? records.find((record) => record.id === recordId) : undefined;
  const match = matchWorldDestination(pathname, { recordIsWorld: !!current && isWorldType(current.type) });

  return (
    <section className="world-nav" aria-label={WORLD.worldSections}>
      {WORLD_DESTINATION_GROUPS.map((group) => {
        const headingId = `${idPrefix}-${group.id}`;
        return (
          <div key={group.id} className="world-nav-group">
            <p className="nav-heading" id={headingId}>
              {group.heading}
            </p>
            <ul className="nav-list" aria-labelledby={headingId}>
              {worldDestinationsInGroup(group).map((destination) => {
                const active = match?.key === destination.key;
                const currentState = active ? (match.exact ? "page" : "true") : undefined;
                return (
                  <li key={destination.key}>
                    <Link href={worldDestinationHref(projectId, destination.key)} aria-current={currentState}>
                      {destination.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
