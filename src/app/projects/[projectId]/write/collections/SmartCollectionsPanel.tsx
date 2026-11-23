"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Atoms/Button";
import type { SmartCollectionFilter } from "@/domain/smartCollection";
import type { Issue } from "@/domain/issues";
import type { SmartCollectionView } from "@/server/services/smartCollectionService";
import { SMART_COLLECTIONS } from "@/ui/labels";
import { createSmartCollectionAction, deleteSmartCollectionAction } from "./actions";

function filterSummary(filter: SmartCollectionFilter): string {
  const parts: string[] = [];
  if (filter.query) parts.push(`${SMART_COLLECTIONS.query}: ${filter.query}`);
  if (filter.pov) parts.push(`${SMART_COLLECTIONS.pov}: ${filter.pov}`);
  if (filter.wordMin !== undefined) parts.push(`${SMART_COLLECTIONS.wordMin}: ${filter.wordMin}`);
  if (filter.wordMax !== undefined) parts.push(`${SMART_COLLECTIONS.wordMax}: ${filter.wordMax}`);
  if (filter.hasUnresolvedContinuity) parts.push(SMART_COLLECTIONS.continuityOpen);
  return parts.length ? parts.join(" · ") : "—";
}

export function SmartCollectionsPanel({
  projectId,
  collections,
}: {
  projectId: string;
  collections: SmartCollectionView[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [pov, setPov] = useState("");
  const [wordMin, setWordMin] = useState("");
  const [wordMax, setWordMax] = useState("");
  const [continuityOpen, setContinuityOpen] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [createPending, startCreate] = useTransition();
  const [deletePending, startDelete] = useTransition();

  return (
    <div className="stack">
      {banner ? <Banner tone="ok">{banner}</Banner> : null}

      <form
        className="stack panel"
        onSubmit={(e) => {
          e.preventDefault();
          setBanner(null);
          setIssues([]);
          const filter: SmartCollectionFilter = {};
          const q = query.trim();
          const p = pov.trim();
          if (q) filter.query = q;
          if (p) filter.pov = p;
          const min = wordMin.trim() ? Number(wordMin) : undefined;
          const max = wordMax.trim() ? Number(wordMax) : undefined;
          if (min !== undefined && Number.isFinite(min)) filter.wordMin = Math.max(0, Math.floor(min));
          if (max !== undefined && Number.isFinite(max)) filter.wordMax = Math.max(0, Math.floor(max));
          if (continuityOpen) filter.hasUnresolvedContinuity = true;
          startCreate(async () => {
            const result = await createSmartCollectionAction(projectId, {
              title,
              scope: "manuscript",
              filter,
            });
            if (!result.ok) {
              setIssues(result.issues ?? []);
              return;
            }
            setTitle("");
            setQuery("");
            setPov("");
            setWordMin("");
            setWordMax("");
            setContinuityOpen(false);
            setBanner(result.message ?? SMART_COLLECTIONS.created);
            router.refresh();
          });
        }}
      >
        <h2 style={{ marginTop: 0 }}>{SMART_COLLECTIONS.new}</h2>
        <p className="small muted">{SMART_COLLECTIONS.scopeManuscript}</p>
        <label>
          {SMART_COLLECTIONS.name}
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} />
        </label>
        <label>
          {SMART_COLLECTIONS.query}
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200} />
        </label>
        <label>
          {SMART_COLLECTIONS.pov}
          <input type="text" value={pov} onChange={(e) => setPov(e.target.value)} maxLength={200} />
        </label>
        <div className="row">
          <label>
            {SMART_COLLECTIONS.wordMin}
            <input type="number" min={0} value={wordMin} onChange={(e) => setWordMin(e.target.value)} />
          </label>
          <label>
            {SMART_COLLECTIONS.wordMax}
            <input type="number" min={0} value={wordMax} onChange={(e) => setWordMax(e.target.value)} />
          </label>
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={continuityOpen}
            onChange={(e) => setContinuityOpen(e.target.checked)}
          />
          {SMART_COLLECTIONS.continuityOpen}
        </label>
        <IssueList issues={issues} />
        <Button type="submit" disabled={createPending}>
          {SMART_COLLECTIONS.save}
        </Button>
      </form>

      <section className="panel" aria-labelledby="collections-list-heading">
        <h2 id="collections-list-heading" style={{ marginTop: 0 }}>
          {SMART_COLLECTIONS.heading}
        </h2>
        {collections.length === 0 ? (
          <p className="muted">{SMART_COLLECTIONS.empty}</p>
        ) : (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {collections.map((row) => (
              <li key={row.id} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <strong>{row.title}</strong>
                  <p className="small muted">{filterSummary(row.filter)}</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={deletePending}
                  onClick={() => {
                    setBanner(null);
                    setIssues([]);
                    if (!window.confirm(`Delete “${row.title}”?`)) return;
                    startDelete(async () => {
                      const result = await deleteSmartCollectionAction(projectId, row.id);
                      if (!result.ok) {
                        setIssues(result.issues ?? []);
                        return;
                      }
                      setBanner(result.message ?? SMART_COLLECTIONS.deleted);
                      router.refresh();
                    });
                  }}
                >
                  {SMART_COLLECTIONS.delete}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}