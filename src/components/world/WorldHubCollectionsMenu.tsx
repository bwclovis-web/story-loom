"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button, ButtonLink } from "@/components/ui/Atoms/Button";
import { MenuPopover } from "@/components/ui/MenuPopover";
import type { Issue } from "@/domain/issues";
import type { SmartCollectionView } from "@/server/services/smartCollectionService";
import { HOME, SMART_COLLECTIONS, WORLD } from "@/ui/labels";
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

export function WorldHubCollectionsMenu({
  projectId,
  query,
  collections,
  activeCollection = null,
  matchCount,
  customCategories = [],
  saveOpen,
  onSaveOpenChange,
  triggerIcon,
}: {
  projectId: string;
  query: WorldHubQuery;
  collections: SmartCollectionView[];
  activeCollection?: SmartCollectionView | null;
  matchCount: number;
  customCategories?: readonly CustomTaxonomyCategoryOption[];
  /** Controlled open state for the save dialog (toolbar). */
  saveOpen?: boolean;
  onSaveOpenChange?: (open: boolean) => void;
  triggerIcon?: ReactNode;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [title, setTitle] = useState("");
  const [renameTitle, setRenameTitle] = useState(activeCollection?.title ?? "");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [internalSaveOpen, setInternalSaveOpen] = useState(false);
  const dialogOpen = saveOpen ?? internalSaveOpen;
  const setDialogOpen = (open: boolean) => {
    if (onSaveOpenChange) onSaveOpenChange(open);
    else setInternalSaveOpen(open);
  };

  const canSave = worldCollectionHasSavableFilters(query);
  const unsupported = unsupportedWorldCollectionFilters(query);
  const previewSummary = summarizeWorldCollectionFilter(
    collectionFilterFromWorldHubQuery(query),
    customCategories,
  );
  const activeSummary = activeCollection
    ? summarizeWorldCollectionFilter(activeCollection.filter, customCategories)
    : null;

  useEffect(() => {
    setRenameTitle(activeCollection?.title ?? "");
  }, [activeCollection?.id, activeCollection?.title]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogOpen) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [dialogOpen]);

  const openHref = (collection: SmartCollectionView) => {
    const restored = worldHubQueryFromCollectionFilter(collection.filter);
    return worldHubHref(projectId, { ...restored, list: true, collection: collection.id });
  };

  const closeSave = () => setDialogOpen(false);

  const saveCollection = (event: FormEvent) => {
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
      closeSave();
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
  };

  return (
    <>
      <MenuPopover
        label={WORLD.collectionsMenu}
        role="menu"
        align="end"
        trigger={
          <Button type="button" size="sm" variant="secondary" icon={triggerIcon}>
            {WORLD.collectionsMenu}
          </Button>
        }
      >
        <div className="world-hub-collections-menu">
          {banner ? <Banner tone="ok">{banner}</Banner> : null}
          <IssueList issues={issues} />
          {!activeCollection ? (
            <Button
              type="button"
              size="sm"
              disabled={!canSave}
              onClick={() => setDialogOpen(true)}
            >
              {WORLD.saveCurrentFilters}
            </Button>
          ) : null}
          {activeCollection ? (
            <div className="stack world-hub-collections-active" style={{ gap: "0.4rem" }}>
              <p className="small" role="status">
                {SMART_COLLECTIONS.worldOpened(activeCollection.title)}
              </p>
              {activeSummary ? <p className="small muted">{activeSummary}</p> : null}
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
                <label className="world-hub-collections-rename">
                  <span className="sr-only">{SMART_COLLECTIONS.name}</span>
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
            </div>
          ) : null}

          {collections.length === 0 ? (
            <p className="muted small">{WORLD.collectionsEmpty}</p>
          ) : (
            <ul className="world-hub-collections-list" role="none">
              {collections.map((collection) => {
                const summary = summarizeWorldCollectionFilter(collection.filter, customCategories);
                const isActive = activeCollection?.id === collection.id;
                return (
                  <li key={collection.id} role="none">
                    <Link role="menuitem" href={openHref(collection)} className="world-hub-collections-item">
                      <strong>{collection.title}</strong>
                      {isActive ? <span className="small muted"> · {WORLD.filterLabel}</span> : null}
                      <span className="small muted">{summary}</span>
                    </Link>
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
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </MenuPopover>

      <dialog
        ref={dialogRef}
        className="world-hub-save-collection-dialog"
        aria-labelledby={titleId}
        onClose={closeSave}
      >
        <form className="stack" style={{ gap: "0.65rem" }} onSubmit={saveCollection}>
          <h2 id={titleId} style={{ margin: 0, fontSize: "1.05rem" }}>
            {WORLD.saveCollectionTitle}
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            {WORLD.saveCollectionLead}
          </p>
          <p className="small">
            <strong>{SMART_COLLECTIONS.worldWillSave}:</strong> {canSave ? previewSummary : "—"}
          </p>
          {unsupported.length ? (
            <Banner tone="warn">
              {SMART_COLLECTIONS.worldUnsupported}: {unsupported.join(", ")}
            </Banner>
          ) : null}
          <IssueList issues={issues} />
          <label>
            {SMART_COLLECTIONS.worldSaveName}
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              required
              disabled={!canSave}
              autoFocus
            />
          </label>
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-end" }}>
            <Button type="button" size="sm" variant="secondary" onClick={closeSave} disabled={pending}>
              {HOME.cancel}
            </Button>
            <Button type="submit" size="sm" disabled={pending || !canSave}>
              {SMART_COLLECTIONS.worldSave}
            </Button>
          </div>
          {!canSave ? <p className="small muted">{SMART_COLLECTIONS.worldNeedFilters}</p> : null}
        </form>
      </dialog>
    </>
  );
}
