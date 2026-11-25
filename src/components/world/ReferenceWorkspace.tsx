"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { CanonBadge, ProtectionStateBadge, SavedVersionBadge } from "@/components/Badges";
import { Button, ButtonLink } from "@/components/ui/Atoms/Button";
import { OpenableImage } from "@/components/ui/ImageLightbox";
import { IconButton } from "@/components/ui/IconButton";
import { MenuPopover } from "@/components/ui/MenuPopover";
import {
  ReferenceProfileEditProvider,
  useReferenceProfileEditRequest,
} from "@/components/world/ReferenceProfileEditContext";
import type { AuthorityStatus } from "@/domain/statuses";
import { CHARACTER_DEVELOPMENT, REFERENCE_FORM, WORLD, WORLD_PROFILE } from "@/ui/labels";
import {
  referenceTabFromHash,
  referenceTabHref,
  resolveReferenceTab,
  visibleReferenceTabs,
  type ReferenceTab,
  type ReferenceTabVisibility,
} from "@/world/referenceTabs";
import { cn } from "@/ui/cn";

export type ReferenceWorkspacePanels = {
  document: ReactNode;
  profile?: ReactNode;
  images: ReactNode;
  relationships: ReactNode;
  established?: ReactNode;
};

export type ReferenceIdentity = {
  thumbnailSrc: string | null;
  thumbnailAlt: string;
  typeLabel: string;
  kindLabel: string | null;
  authorityStatus: AuthorityStatus;
  isProtected: boolean;
  revision: number;
};

function tabFromLocation(visibility: ReferenceTabVisibility, fallback: ReferenceTab): ReferenceTab {
  if (typeof window === "undefined") return fallback;
  const params = new URLSearchParams(window.location.search);
  const fromQuery = resolveReferenceTab(params.get("tab"), visibility);
  const fromHash = referenceTabFromHash(window.location.hash);
  if (fromHash && visibleReferenceTabs(visibility).includes(fromHash)) return fromHash;
  return fromQuery;
}

/**
 * Tabbed reference workspace: identity strip, URL-synced tabs, More menu.
 * Panels stay mounted (hidden) so document/profile drafts are not discarded on tab change.
 */
export function ReferenceWorkspace({
  recordHref,
  editing,
  canvasPath,
  visibility,
  identity,
  editHref,
  moreItems,
  panels,
  initialTab = "document",
}: {
  recordHref: string;
  editing: boolean;
  canvasPath: string | null;
  visibility: ReferenceTabVisibility;
  identity: ReferenceIdentity;
  editHref: string;
  moreItems: Array<{ href: string; label: string }>;
  panels: ReferenceWorkspacePanels;
  /** Server-resolved tab from `?tab=` so first paint matches the URL. */
  initialTab?: ReferenceTab;
}) {
  const router = useRouter();
  const idPrefix = useId();
  const migratedHash = useRef(false);
  const tabs = useMemo(() => visibleReferenceTabs(visibility), [visibility]);
  const resolvedInitial = resolveReferenceTab(initialTab, visibility);
  const [active, setActive] = useState<ReferenceTab>(resolvedInitial);

  // Sync from Back/Forward and legacy hashes without useSearchParams (avoids Suspense).
  useEffect(() => {
    const sync = () => setActive(tabFromLocation(visibility, resolvedInitial));
    if (!migratedHash.current) {
      migratedHash.current = true;
      const hash = window.location.hash;
      const fromHash = referenceTabFromHash(hash);
      if (fromHash && tabs.includes(fromHash) && fromHash !== active) {
        const keepHash = hash.startsWith("#doc-") || hash === "#reference-editor" ? hash : "";
        const href = referenceTabHref(recordHref, fromHash, {
          edit: editing,
          canvasPath,
          hash: keepHash || undefined,
        });
        router.replace(href);
        setActive(fromHash);
        if (keepHash.startsWith("#doc-")) {
          requestAnimationFrame(() => {
            document.getElementById(keepHash.slice(1))?.scrollIntoView({ block: "start" });
          });
        }
      } else if (hash.startsWith("#doc-")) {
        requestAnimationFrame(() => {
          document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
        });
      } else {
        sync();
      }
    }
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [active, canvasPath, editing, recordHref, resolvedInitial, router, tabs, visibility]);

  const labels: Record<ReferenceTab, string> = {
    document: REFERENCE_FORM.tabDocument,
    profile:
      visibility.profile === "character"
        ? REFERENCE_FORM.tabCharacterProfile
        : REFERENCE_FORM.tabProfile,
    images: REFERENCE_FORM.tabImages,
    relationships: REFERENCE_FORM.tabRelationships,
    established: REFERENCE_FORM.tabEstablished,
  };

  const selectTab = (tab: ReferenceTab) => {
    if (tab === active) return;
    // Panels stay mounted (hidden), so tab changes do not discard drafts.
    const href = referenceTabHref(recordHref, tab, {
      edit: editing,
      canvasPath,
    });
    setActive(tab);
    router.push(href);
  };

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.indexOf(active);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    const id = tabs[next]!;
    selectTab(id);
    document.getElementById(`${idPrefix}-tab-${id}`)?.focus();
  };

  const panelFor = (tab: ReferenceTab): ReactNode => {
    switch (tab) {
      case "document":
        return panels.document;
      case "profile":
        return panels.profile ?? null;
      case "images":
        return panels.images;
      case "relationships":
        return panels.relationships;
      case "established":
        return panels.established ?? null;
    }
  };

  return (
    <ReferenceProfileEditProvider>
      <ReferenceWorkspaceBody
        recordHref={recordHref}
        editing={editing}
        canvasPath={canvasPath}
        visibility={visibility}
        identity={identity}
        editHref={editHref}
        moreItems={moreItems}
        idPrefix={idPrefix}
        tabs={tabs}
        labels={labels}
        active={active}
        selectTab={selectTab}
        onTabKey={onTabKey}
        panelFor={panelFor}
      />
    </ReferenceProfileEditProvider>
  );
}

function ReferenceWorkspaceBody({
  recordHref,
  editing,
  canvasPath,
  identity,
  editHref,
  moreItems,
  idPrefix,
  tabs,
  labels,
  active,
  selectTab,
  onTabKey,
  panelFor,
  visibility,
}: {
  recordHref: string;
  editing: boolean;
  canvasPath: string | null;
  identity: ReferenceIdentity;
  editHref: string;
  moreItems: Array<{ href: string; label: string }>;
  idPrefix: string;
  tabs: ReferenceTab[];
  labels: Record<ReferenceTab, string>;
  active: ReferenceTab;
  selectTab: (tab: ReferenceTab) => void;
  onTabKey: (event: KeyboardEvent<HTMLDivElement>) => void;
  panelFor: (tab: ReferenceTab) => ReactNode;
  visibility: ReferenceTabVisibility;
}) {
  const profileEdit = useReferenceProfileEditRequest();
  const onProfileTab = active === "profile" && Boolean(visibility.profile);
  const profileEditLabel =
    visibility.profile === "character" ? CHARACTER_DEVELOPMENT.editProfile : WORLD_PROFILE.editProfile;

  const primaryAction = onProfileTab ? (
    <Button
      type="button"
      onClick={() => {
        profileEdit?.requestEdit();
      }}
    >
      {profileEditLabel}
    </Button>
  ) : editing ? (
    <ButtonLink href={referenceTabHref(recordHref, "document", { canvasPath })} variant="secondary">
      {WORLD.doneEditing}
    </ButtonLink>
  ) : (
    <ButtonLink href={editHref}>{REFERENCE_FORM.editDocument}</ButtonLink>
  );

  return (
    <div className="reference-workspace">
      <div className="reference-identity" aria-label={REFERENCE_FORM.identityDetails}>
        {identity.thumbnailSrc ? (
          <OpenableImage
            src={identity.thumbnailSrc}
            alt={identity.thumbnailAlt}
            className="reference-identity-thumb-trigger"
            imgClassName="reference-identity-thumb"
            width={72}
            height={72}
          />
        ) : null}
        <div className="reference-identity-meta">
          <p className="reference-identity-type">
            <span>{identity.typeLabel}</span>
            {identity.kindLabel ? (
              <>
                <span aria-hidden="true"> · </span>
                <span>{identity.kindLabel}</span>
              </>
            ) : null}
          </p>
          <ul className="reference-identity-badges">
            <li>
              <CanonBadge status={identity.authorityStatus} />
            </li>
            <li>
              <SavedVersionBadge revision={identity.revision} />
            </li>
            <li>
              <ProtectionStateBadge isProtected={identity.isProtected} />
            </li>
          </ul>
        </div>
        <div className="reference-identity-actions">
          {primaryAction}
          <MenuPopover
            label={REFERENCE_FORM.moreActions}
            align="end"
            as="ul"
            trigger={
              <IconButton tip="end" aria-label={REFERENCE_FORM.moreActions}>
                <MoreHorizontal strokeWidth={1.75} aria-hidden="true" />
              </IconButton>
            }
          >
            {moreItems.map((item) => (
              <li key={item.href + item.label}>
                <Link className="menu-item" href={item.href}>
                  {item.label}
                </Link>
              </li>
            ))}
          </MenuPopover>
        </div>
      </div>

      <div
        className="reference-tabs"
        role="tablist"
        aria-label={REFERENCE_FORM.workspaceTabs}
        onKeyDown={onTabKey}
      >
        {tabs.map((tab) => {
          const selected = tab === active;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${tab}`}
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel-${tab}`}
              tabIndex={selected ? 0 : -1}
              className={cn("reference-tab", selected && "is-active")}
              onClick={() => selectTab(tab)}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => {
        const selected = tab === active;
        return (
          <div
            key={tab}
            role="tabpanel"
            id={`${idPrefix}-panel-${tab}`}
            aria-labelledby={`${idPrefix}-tab-${tab}`}
            hidden={!selected}
            className="reference-tab-panel"
          >
            {panelFor(tab)}
          </div>
        );
      })}
    </div>
  );
}
