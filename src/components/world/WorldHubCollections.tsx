"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button, ButtonLink } from "@/components/ui/Atoms/Button";
import type { Issue } from "@/domain/issues";
import type { SmartCollectionView } from "@/server/services/smartCollectionService";
import { SMART_COLLECTIONS, WORLD } from "@/ui/labels";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
import type { WorldHubQuery } from "@/world/hubDiscovery";
import { worldHubHref } from "@/world/hubDiscovery";
import {
  collectionFilterFromWorldHubQuery,
  summarizeWorldCollectionFilter,
  unsupportedWorldCollectionFilters,
  worldCollectionHasSavableFilters,
  worldHubQueryFromCollectionFilter,
} from "@/world/worldHubCollections";
import {
  createSmartCollectionAction,
  deleteSmartCollectionAction,
  updateSmartCollectionAction,
} from "@/app/projects/[projectId]/write/collections/actions";

export function WorldHubCollections({
  projectId,
  query,
  collections,
  activeCollection = null,
  matchCount,
  customCategories = [],
}: {
  projectId: string;
  query: WorldHubQuery;
  collections: SmartCollectionView[];
  activeCollection?: SmartCollectionView | null;
  matchCount: number;
  customCategories?: readonly CustomTaxonomyCategoryOption[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [renameTitle, setRenameTitle] = useState(activeCollection?.title ?? "");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const previewFilter = collectionFilterFromWorldHubQuery(query);
  const previewSummary = summarizeWorldCollectionFilter(previewFilter, customCategories);
  const canSave = worldCollectionHasSavableFilters(query);
  const unsupported = unsupportedWorldCollectionFilters(query);
  const activeSummary = activeCollection
    ? summarizeWorldCollectionFilter(activeCollection.filter, customCategories)
    : null;

  const openHref = (collection: SmartCollectionView) => {
    const restored = worldHubQueryFromCollectionFilter(collection.filter);
    return worldHubHref(projectId, { ...restored, list: true, collection: collection.id });
  };

  return (
    <section className="panel world-hub-collections" aria-labelledby="world-collections-heading">
      <h2 id="world-collections-heading" style={{ marginTop: 0 }}>
        {SMART_COLLECTIONS.worldHeading}
      </h2>
      <p className="small muted">{SMART_COLLECTIONS.worldLead}</p>
      {banner ? <Banner tone="ok">{banner}</Banner> : null}
      <IssueList issues={issues} />

      {activeCollection ? (
        <div className="stack" style={{ gap: "0.5rem", marginBottom: "0.75rem" }}>
          <p className="small" role="status">
            {SMART_COLLECTIONS.worldOpened(activeCollection.title)}
          </p>
          <p className="small muted">
            {SMART_COLLECTIONS.worldWillSave}: {activeSummary}
          </p>
          {matchCount === 0 ? (
            <Banner tone="info">
              {SMART_COLLECTIONS.worldEmptyMatches} {SMART_COLLECTIONS.worldEmptyMatchesHint}
            </Banner>
          ) : null}
          <form
            className="row"
            style={{ flexWrap: "wrap", gap: "0.35rem", alignItems: "end" }}
            onSubmit={(event) => {
              event.preventDefault();
              setIssues([]);
              setBanner(null);
              startTransition(async () => {
                const result = await updateSmartCollectionAction(projectId, activeCollection.id, {
                  title: renameTitle,
                });
                if (!result.ok) {
                  setIssues(result.issues ?? []);
                  return;
                }
                setBanner(result.message ?? SMART_COLLECTIONS.renamed);
                router.refresh();
              });
            }}
          >
            <label>
              {SMART_COLLECTIONS.name}
              <input
                type="text"
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
                maxLength={120}
                required
              />
            </label>
            <Button type="submit" size="sm" variant="secondary" disabled={pending}>
              {SMART_COLLECTIONS.worldRename}
            </Button>
          </form>
          <div className="row" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
            <Button
              type="button"
              size="sm"
              disabled={pending || !canSave}
              onClick={() => {
                setIssues([]);
                setBanner(null);
                if (!canSave) {
                  setIssues([]);
                  setBanner(null);
                  return;
                }
                startTransition(async () => {
                  const result = await updateSmartCollectionAction(projectId, activeCollection.id, {
                    filter: collectionFilterFromWorldHubQuery(query),
                  });
                  if (!result.ok) {
                    setIssues(result.issues ?? []);
                    return;
                  }
                  setBanner(result.message ?? SMART_COLLECTIONS.updated);
                  router.refresh();
                });
              }}
            >
              {SMART_COLLECTIONS.worldUpdate}
            </Button>
            <ButtonLink href={worldHubHref(projectId, { list: true })} variant="secondary" size="sm">
              {SMART_COLLECTIONS.worldAllReferences}
            </ButtonLink>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(SMART_COLLECTIONS.worldDeleteConfirm(activeCollection.title))) return;
                setIssues([]);
                setBanner(null);
                startTransition(async () => {
                  const result = await deleteSmartCollectionAction(projectId, activeCollection.id);
                  if (!result.ok) {
                    setIssues(result.issues ?? []);
                    return;
                  }
                  setBanner(result.message ?? SMART_COLLECTIONS.deleted);
                  router.push(worldHubHref(projectId, { list: true }));
                  router.refresh();
                });
              }}
            >
              {SMART_COLLECTIONS.delete}
            </Button>
          </div>
          <p className="small muted">{SMART_COLLECTIONS.worldUpdateHint}</p>
          {canSave ? (
            <p className="small muted">
              {SMART_COLLECTIONS.worldWillSave}: {previewSummary}
            </p>
          ) : null}
        </div>
      ) : (
        <form
          className="stack"
          style={{ gap: "0.5rem", marginBottom: "0.75rem" }}
          onSubmit={(event) => {
            event.preventDefault();
            setIssues([]);
            setBanner(null);
            if (!canSave) {
              setBanner(SMART_COLLECTIONS.worldNeedFilters);
              return;
            }
            startTransition(async () => {
              const result = await createSmartCollectionAction(projectId, {
                title,
                scope: "world",
                filter: collectionFilterFromWorldHubQuery(query),
              });
              if (!result.ok) {
                setIssues(result.issues ?? []);
                return;
              }
              setTitle("");
              setBanner(result.message ?? SMART_COLLECTIONS.created);
              if (result.collectionId) {
                router.push(
                  worldHubHref(projectId, {
                    ...query,
                    list: true,
                    collection: result.collectionId,
                  }),
                );
              }
              router.refresh();
            });
          }}
        >
          <p className="small">
            <strong>{SMART_COLLECTIONS.worldWillSave}:</strong> {canSave ? previewSummary : "—"}
          </p>
          {unsupported.length ? (
            <Banner tone="warn">
              {SMART_COLLECTIONS.worldUnsupported}: {unsupported.join(", ")}
            </Banner>
          ) : null}
          <label>
            {SMART_COLLECTIONS.worldSaveName}
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              required
              disabled={!canSave}
              placeholder={canSave ? previewSummary.slice(0, 80) : undefined}
            />
          </label>
          <Button type="submit" size="sm" disabled={pending || !canSave}>
            {SMART_COLLECTIONS.worldSave}
          </Button>
          {!canSave ? <p className="small muted">{SMART_COLLECTIONS.worldNeedFilters}</p> : null}
        </form>
      )}

      {collections.length === 0 ? (
        <p className="muted small">{SMART_COLLECTIONS.worldEmpty}</p>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: "0.5rem" }}>
          {collections.map((collection) => {
            const summary = summarizeWorldCollectionFilter(collection.filter, customCategories);
            const isActive = activeCollection?.id === collection.id;
            return (
              <li key={collection.id} className="row" style={{ justifyContent: "space-between", gap: "0.5rem" }}>
                <div>
                  <strong>{collection.title}</strong>
                  {isActive ? <span className="small muted"> · {WORLD.filterLabel}</span> : null}
                  <p className="small muted" style={{ margin: "0.15rem 0 0" }}>
                    {summary}
                  </p>
                </div>
                <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                  <ButtonLink href={openHref(collection)} size="sm" variant={isActive ? "primary" : "secondary"}>
                    {SMART_COLLECTIONS.worldOpen}
                  </ButtonLink>
                  {!isActive ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(SMART_COLLECTIONS.worldDeleteConfirm(collection.title))) return;
                        setIssues([]);
                        setBanner(null);
                        startTransition(async () => {
                          const result = await deleteSmartCollectionAction(projectId, collection.id);
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
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {activeCollection && matchCount === 0 ? (
        <p className="small">
          <Link href={openHref(activeCollection)}>{SMART_COLLECTIONS.worldOpen}</Link>
          {" · "}
          <Link href={worldHubHref(projectId)}>{SMART_COLLECTIONS.worldAllReferences}</Link>
        </p>
      ) : null}
    </section>
  );
}
