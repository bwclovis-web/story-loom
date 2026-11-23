"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { WORLD } from "@/ui/labels";
import { readRecentAccess, type RecentAccessEntry } from "@/world/recentAccess";

/** Recently opened World references for this project (localStorage). */
export function WorldRecentAccessed({
  projectId,
  knownIds,
}: {
  projectId: string;
  /** Live record ids in this hub (local + series-shared). Drop missing ones. */
  knownIds: readonly string[];
}) {
  const [entries, setEntries] = useState<RecentAccessEntry[]>([]);
  useEffect(() => {
    const known = new Set(knownIds);
    setEntries(readRecentAccess(projectId).filter((entry) => known.has(entry.id)));
  }, [projectId, knownIds]);

  const base = `/projects/${encodeURIComponent(projectId)}`;
  return (
    <section aria-labelledby="world-accessed-heading">
      <div className="world-section-head">
        <h2 id="world-accessed-heading">{WORLD.recentAccessed}</h2>
      </div>
      {entries.length === 0 ? (
        <EmptyState>{WORLD.noRecentAccessed}</EmptyState>
      ) : (
        <ul className="world-recent">
          {entries.slice(0, 8).map((entry) => (
            <li key={entry.id}>
              <Link className="world-recent-title" href={`${base}/records/${encodeURIComponent(entry.id)}`}>
                {entry.title}
              </Link>
              <p className="world-recent-meta small muted">
                {new Date(entry.openedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
