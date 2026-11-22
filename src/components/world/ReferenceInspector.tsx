"use client";

import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { CanonBadge, ProtectionStateBadge, SavedVersionBadge } from "@/components/Badges";
import {
  EstablishedInRail,
  type DraftChoice,
  type EvidenceSourceChoice,
  type SceneChoice,
} from "@/app/projects/[projectId]/records/[recordId]/EstablishedInRail";
import type { EstablishedFactView } from "@/server/services/establishedFactService";
import { CHARACTER_DEVELOPMENT, IMAGES, REFERENCE_FORM, WORLD, WORLD_KIND } from "@/ui/labels";
import { placementHref, type ReferenceInspectorModel } from "@/world/inspectorModel";

export interface InspectorEstablished {
  facts: EstablishedFactView[];
  evidenceSources: EvidenceSourceChoice[];
  drafts: DraftChoice[];
  scenes: SceneChoice[];
}

const TAB_ORDER = ["overview", "sections", "images", "relationships", "established"] as const;
type InspectorTab = (typeof TAB_ORDER)[number];

/**
 * One reference inspector for a record page, a board card, and a map pin.
 * Tabs that the record cannot support (Established in on a note) are omitted.
 */
export function ReferenceInspector({
  projectId,
  model,
  established,
  linkMode,
  editing = false,
  sourceNote,
  overviewExtra,
  relationshipsExtra,
  /** Record page already shows the header. A board or map still needs identity here. */
  context = "remote",
  hasDetails = true,
}: {
  projectId: string;
  model: ReferenceInspectorModel;
  established: InspectorEstablished | null;
  /** Hash links on the open record; full links from a board or map. */
  linkMode: "page" | "remote";
  editing?: boolean;
  sourceNote?: string | null;
  overviewExtra?: ReactNode;
  relationshipsExtra?: ReactNode;
  context?: "page" | "remote";
  hasDetails?: boolean;
}) {
  const idPrefix = useId();
  const showEstablished = model.supportsEstablished && established !== null;
  const tabs = TAB_ORDER.filter((tab) => tab !== "established" || showEstablished);
  const [tab, setTab] = useState<InspectorTab>("overview");
  const [openImageId, setOpenImageId] = useState<string | null>(null);
  const active = tabs.includes(tab) ? tab : "overview";
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const recordHref = `${base}/records/${encodeURIComponent(model.id)}`;
  const sectionHref = (id: string) => (linkMode === "page" ? `#${id}` : `${recordHref}#${id}`);
  const boards = model.placements.filter((placement) => placement.surface === "board");
  const maps = model.placements.filter((placement) => placement.surface === "map");

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
    setTab(id);
    document.getElementById(`${idPrefix}-tab-${id}`)?.focus();
  };

  const labels: Record<InspectorTab, string> = {
    overview: WORLD.inspectorOverview,
    sections: WORLD.inspectorSections,
    images: WORLD.inspectorImages,
    relationships: WORLD.inspectorRelationships,
    established: WORLD.establishedIn,
  };

  return (
    <div className="reference-inspector">
      <div
        className="context-tabs inspector-tabs"
        role="tablist"
        aria-label={WORLD.inspectorTabs}
        aria-describedby={`${idPrefix}-tab-hint`}
        onKeyDown={onTabKey}
      >
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            className="context-tab"
            id={`${idPrefix}-tab-${id}`}
            role="tab"
            aria-selected={active === id}
            aria-controls={`${idPrefix}-panel-${id}`}
            tabIndex={active === id ? 0 : -1}
            onClick={() => setTab(id)}
          >
            {labels[id]}
          </button>
        ))}
      </div>
      <p id={`${idPrefix}-tab-hint`} className="sr-only">
        {WORLD.inspectorTabHint}
      </p>

      <div role="tabpanel" id={`${idPrefix}-panel-overview`} aria-labelledby={`${idPrefix}-tab-overview`} hidden={active !== "overview"}>
        <div className="stack">
          {sourceNote ? <p className="small muted">{sourceNote}</p> : null}
          {context === "page" ? (
            <div className="stack">
              {hasDetails ? (
                <p className="reference-inspector-actions">
                  <a href={`${recordHref}?edit=1#reference-editor`}>{REFERENCE_FORM.editDetails}</a>
                  {model.recordType === "worldbuilding" ? (
                    <>
                      {" "}
                      <a href={`${recordHref}?edit=1#reference-editor`}>{REFERENCE_FORM.changeKind}</a>
                    </>
                  ) : null}
                </p>
              ) : null}
              {editing ? <p className="small muted">{WORLD.inspectorSavedNote}</p> : null}
            </div>
          ) : (
            <>
              <div>
                <h3 className="inspector-record-title">{model.title}</h3>
                <p className="row small" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
                  <span className="badge labelled type">
                    <span className="badge-label">{WORLD.documentType}:</span> {model.typeLabel}
                  </span>
                  {model.worldKindLabel !== undefined ? (
                    <span className="badge labelled type">
                      <span className="badge-label">{WORLD_KIND.fieldKind}:</span>{" "}
                      {model.worldKindLabel ?? <span className="muted">{WORLD_KIND.kindNone}</span>}
                    </span>
                  ) : null}
                  <CanonBadge status={model.authorityStatus} />
                  <SavedVersionBadge revision={model.revision} />
                  <ProtectionStateBadge isProtected={model.protected} />
                </p>
              </div>
              {editing ? <p className="small muted">{WORLD.inspectorSavedNote}</p> : null}
              {model.lead ? <p className="small inspector-lead">{model.lead}</p> : <p className="small muted">{WORLD.emptyDocument}</p>}
            </>
          )}
          <div>
            <h3>{WORLD.onBoardsAndMaps}</h3>
            {model.placements.length === 0 ? (
              <p className="small muted">{WORLD.notPlaced}</p>
            ) : (
              <>
                {boards.length ? (
                  <ul className="context-links">
                    {boards.map((placement) => (
                      <li key={placement.itemId}>
                        <Link href={placementHref(projectId, placement)}>
                          {WORLD.boards}: {placement.surfaceTitle}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {maps.length ? (
                  <ul className="context-links">
                    {maps.map((placement) => (
                      <li key={placement.itemId}>
                        <Link href={placementHref(projectId, placement)}>
                          {WORLD.maps}: {placement.surfaceTitle}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>
          {model.developmentLines.length ? (
            <div>
              <h3>{CHARACTER_DEVELOPMENT.heading}</h3>
              {model.developmentStale ? <p className="small">{CHARACTER_DEVELOPMENT.staleProfile}</p> : null}
              <ul className="small">
                {model.developmentLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="small">
                <a href={linkMode === "page" ? "#character-development" : `${recordHref}#character-development`}>
                  {CHARACTER_DEVELOPMENT.openDossier}
                </a>
              </p>
            </div>
          ) : null}
          {linkMode === "remote" ? (
            <ButtonLink variant="secondary" size="sm" href={recordHref}>
              {WORLD.inspectorOpenRecord}
            </ButtonLink>
          ) : null}
          {overviewExtra}
        </div>
      </div>

      <div role="tabpanel" id={`${idPrefix}-panel-sections`} aria-labelledby={`${idPrefix}-tab-sections`} hidden={active !== "sections"}>
        {model.sections.length === 0 ? (
          <p className="small muted">{WORLD.noHeadings}</p>
        ) : (
          <ol className="doc-contents">
            {model.sections.map((section) => (
              <li key={section.id} style={{ paddingLeft: `${Math.max(0, section.level - 1) * 0.75}rem` }}>
                <a href={sectionHref(section.id)}>{section.title}</a>
                {section.excerpt ? <p className="small muted">{section.excerpt}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div role="tabpanel" id={`${idPrefix}-panel-images`} aria-labelledby={`${idPrefix}-tab-images`} hidden={active !== "images"}>
        {model.images.length === 0 ? (
          <p className="small muted">{WORLD.noInspectorImages}</p>
        ) : (
          <ul className="inspector-images">
            {model.images.map((image) => (
              <li key={image.id}>
                <button
                  type="button"
                  className="inspector-image-open"
                  aria-label={IMAGES.open(image.name)}
                  onClick={() => setOpenImageId(image.id)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- project image route */}
                  <img
                    src={`${base}/images/${encodeURIComponent(image.id)}`}
                    alt=""
                    className="inspector-thumb"
                  />
                </button>
                <p className="small">
                  {image.caption || image.name}
                  {image.altText && image.altText !== image.caption ? <span className="muted"> — {image.altText}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        role="tabpanel"
        id={`${idPrefix}-panel-relationships`}
        aria-labelledby={`${idPrefix}-tab-relationships`}
        hidden={active !== "relationships"}
      >
        <div className="stack">
          {model.relations.length === 0 ? (
            <p className="small muted">{WORLD.noPlaceRelations}</p>
          ) : (
            <ul className="context-links">
              {model.relations.map((relation) => (
                <li key={`${relation.direction}-${relation.id}`}>
                  <span className="small muted">
                    {relation.direction === "from" ? WORLD.relationOutgoing : WORLD.relationIncoming}: {relation.kindLabel}.{" "}
                  </span>
                  <Link href={`${base}/records/${encodeURIComponent(relation.otherRecordId)}`}>{relation.otherTitle}</Link>
                  <span className="small muted"> {relation.otherTypeLabel}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="small row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
            <a href={sectionHref("place-relations")}>{WORLD.editPlaceRelations}</a>
            {model.supportsRecordRelations ? (
              <a href={sectionHref("record-relations")}>{WORLD.editRecordRelations}</a>
            ) : null}
          </p>
          <h3>{WORLD.linkedManuscript}</h3>
          {model.manuscriptLinks.length ? (
            <ul className="context-links">
              {model.manuscriptLinks.map((link) => (
                <li key={link.recordId}>
                  <Link href={`${base}/records/${encodeURIComponent(link.recordId)}`}>{link.title}</Link>
                  <span className="small muted">
                    {" "}
                    {link.typeLabel}
                    {link.chapterTitle ? `, in ${link.chapterTitle}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">{WORLD.noLinkedManuscript}</p>
          )}
          {relationshipsExtra}
        </div>
      </div>

      {showEstablished && established ? (
        <div
          role="tabpanel"
          id={`${idPrefix}-panel-established`}
          aria-labelledby={`${idPrefix}-tab-established`}
          hidden={active !== "established"}
        >
          <EstablishedInRail
            projectId={projectId}
            subjectRecordId={model.id}
            recordType={model.recordType}
            initialFacts={established.facts}
            evidenceSources={established.evidenceSources}
            drafts={established.drafts}
            scenes={established.scenes}
          />
        </div>
      ) : null}
      <ImageLightbox
        images={model.images.map((image) => ({
          id: image.id,
          src: `${base}/images/${encodeURIComponent(image.id)}`,
          alt: image.altText || image.caption || image.name,
          caption: image.caption || image.name,
        }))}
        openId={openImageId}
        onOpenId={setOpenImageId}
        onClose={() => setOpenImageId(null)}
      />
    </div>
  );
}
