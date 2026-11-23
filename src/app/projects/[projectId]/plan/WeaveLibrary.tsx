"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FileSearch, Layers, LayoutTemplate, Map, Plus } from "lucide-react";
import { LandingHeader } from "@/components/library/LandingHeader";
import { ProjectOnboarding } from "@/components/shell/ProjectOnboarding";
import { WorkspaceToolsChooser } from "@/components/shell/WorkspaceToolsChooser";
import { ChevronRightIcon, ListRowsIcon, SearchIcon } from "@/components/shell/icons";
import { OverflowDisclosure } from "@/components/shell/OverflowDisclosure";
import { Button, ButtonLink } from "@/components/ui/Atoms/Button";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { ANALYZE, NAV, SHELL, WEAVE, WORLD } from "@/ui/labels";
import { weaveLibraryEntries, type WeaveLibraryGrid } from "@/ui/weaveLibrary";
import type { WeaveViewKind } from "@/server/services/weaveService";
import type { SpellingLanguage } from "@/writing/spelling";
import { NewRecordForm } from "../NewRecordForm";
import { CreateWeaveGridForm } from "./weave/CreateWeaveGridForm";
import { DeleteWeavePlanButton } from "./weave/DeleteWeavePlanButton";
import { StructureAdoptPanel } from "./weave/StructureAdoptPanel";

const SCOPE_HELP: Record<WeaveViewKind, string> = {
  original: WEAVE.scopeHelpOriginal,
  zero_draft_map: WEAVE.scopeHelpZero,
  author_rewrite: WEAVE.scopeHelpRewrite,
};

export type PlanningReferenceGroup = {
  label: string;
  records: { id: string; title: string }[];
};

export function WeaveLibrary({
  projectId,
  title,
  eyebrow,
  coverSrc,
  grids,
  references,
  spellingLanguage,
  openReviewItems,
}: {
  projectId: string;
  title: string;
  eyebrow: string;
  coverSrc: string | null;
  grids: WeaveLibraryGrid[];
  references: PlanningReferenceGroup[];
  spellingLanguage: SpellingLanguage;
  openReviewItems: number;
}) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingOpen = useRef(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<WeaveViewKind>("original");
  const [formKey, setFormKey] = useState(0);
  const entries = weaveLibraryEntries(grids, query);
  const needle = query.trim();

  useEffect(() => {
    if (!pendingOpen.current) return;
    pendingOpen.current = false;
    dialogRef.current?.showModal();
  }, [formKey]);

  const openCreate = (next: WeaveViewKind, opener: HTMLElement) => {
    openerRef.current = opener;
    pendingOpen.current = true;
    setKind(next);
    setFormKey((n) => n + 1);
  };

  const closeCreate = () => dialogRef.current?.close();

  return (
    <div className="weave-library">
      <LandingHeader
        projectId={projectId}
        title={title}
        eyebrow={eyebrow}
        coverSrc={coverSrc}
        description={WEAVE.libraryLead}
        gettingStarted={<ProjectOnboarding projectId={projectId} quiet marked />}
      />
      <div className="weave-main">
        <div className="weave-toolbar">
          <div className="weave-search" role="search">
            <label className="weave-search-field">
              <span className="sr-only">{WEAVE.searchGrids}</span>
              <SearchIcon />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder={WEAVE.searchGrids}
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {needle ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
              >
                {WEAVE.clearSearch}
              </Button>
            ) : null}
          </div>
          <Button type="button" icon={<Plus strokeWidth={1.75} />} onClick={(event) => openCreate("original", event.currentTarget)}>
            {WEAVE.newGridAction}
          </Button>
        </div>

        <section className="weave-collection" aria-labelledby="weave-grids-heading">
          <h2 id="weave-grids-heading" className="sr-only">
            {WEAVE.gridsHeading}
          </h2>
          {needle ? (
            <p className={entries.length === 0 ? "weave-search-status" : "sr-only"} role="status">
              {entries.length === 0 ? WEAVE.noGridMatches : WEAVE.searchStatus(entries.length, needle)}
            </p>
          ) : null}
          <ul className="weave-grids">
            {entries.map((entry) =>
              entry.kind === "grid" ? (
                <li key={entry.grid.id}>
                  <article className="weave-card weave-card-saved">
                    <GridMotif />
                    <div className="weave-card-copy">
                      <h3>{entry.grid.title}</h3>
                      <div className="weave-card-meta">
                        <span>
                          {WEAVE.scopeLine(entry.grid.viewLabel, WEAVE.beatsCount(entry.grid.beatCount))}
                          <HelpPopover label={WEAVE.scopeHelpLabel(entry.grid.viewLabel)}>{SCOPE_HELP[entry.grid.viewKind]}</HelpPopover>
                        </span>
                      </div>
                    </div>
                    <div className="weave-card-action weave-card-actions">
                      <ButtonLink
                        href={`${base}/plan/weave/${encodeURIComponent(entry.grid.id)}`}
                        size="sm"
                        aria-label={WEAVE.openGridNamed(entry.grid.title)}
                      >
                        {WEAVE.openGridAction}
                      </ButtonLink>
                      <DeleteWeavePlanButton
                        projectId={projectId}
                        gridId={entry.grid.id}
                        title={entry.grid.title}
                      />
                    </div>
                  </article>
                </li>
              ) : (
                <li key={entry.viewKind}>
                  <article className="weave-card weave-card-missing">
                    <GridMotif missing />
                    <div className="weave-card-copy">
                      <div className="weave-card-title">
                        <h3>
                          {entry.viewLabel}
                          <HelpPopover label={WEAVE.scopeHelpLabel(entry.viewLabel)}>{SCOPE_HELP[entry.viewKind]}</HelpPopover>
                        </h3>
                      </div>
                      <p className="weave-card-meta">{WEAVE.notCreated}</p>
                    </div>
                    <div className="weave-card-action">
                      <Button
                        type="button"
                        variant="brass"
                        size="sm"
                        aria-label={WEAVE.createGridNamed(entry.viewLabel)}
                        onClick={(event) => openCreate(entry.viewKind, event.currentTarget)}
                      >
                        {WEAVE.createGridAction}
                      </Button>
                    </div>
                  </article>
                </li>
              ),
            )}
          </ul>
          <div className="weave-note">
            <p>
              {WEAVE.movingBeatsNote}
              <HelpPopover label={WEAVE.movingBeatsHelp}>{WEAVE.dragBeatHint}</HelpPopover>
            </p>
          </div>
          <StructureAdoptPanel
            projectId={projectId}
            grids={grids.map((grid) => ({
              id: grid.id,
              title: grid.title,
              viewKind: grid.viewKind,
              viewLabel: grid.viewLabel,
            }))}
          />
          {grids.length === 0 ? <WorkspaceToolsChooser projectId={projectId} emphasize="weave" /> : null}
        </section>

        <PlanningReferences base={base} projectId={projectId} references={references} spellingLanguage={spellingLanguage} />
      </div>

      <aside className="weave-tools" aria-label={WEAVE.toolsAside}>
        <section aria-labelledby="weave-planning-tools">
          <h2 id="weave-planning-tools">{WEAVE.planningTools}</h2>
          <ul className="weave-tool-list">
            <li>
              <ToolLink
                href={`${base}/plan/weave/templates`}
                title={WEAVE.templates}
                description={WEAVE.templatesHint}
                icon={<LayoutTemplate strokeWidth={1.6} />}
              />
            </li>
            <li>
              <ToolLink
                href={`${base}/analyze`}
                title={ANALYZE.heading}
                description={WEAVE.analyzeHint}
                icon={<FileSearch strokeWidth={1.6} />}
              />
            </li>
            <li>
              <ToolLink
                href={`${base}/plan/weave/build`}
                title={WEAVE.buildFromDraft}
                description={WEAVE.buildFromDraftHint}
                icon={<ListRowsIcon />}
              />
            </li>
          </ul>
        </section>
        <section aria-labelledby="weave-world-tools">
          <h2 id="weave-world-tools">{WEAVE.worldTools}</h2>
          <ul className="weave-tool-list">
            <li>
              <ToolLink href={`${base}/world/boards`} title={WORLD.boards} description={WEAVE.boardsHint} icon={<Layers strokeWidth={1.6} />} />
            </li>
            <li>
              <ToolLink href={`${base}/world/maps`} title={WORLD.maps} description={WEAVE.mapsHint} icon={<Map strokeWidth={1.6} />} />
            </li>
          </ul>
        </section>
        <ProjectTools base={base} openReviewItems={openReviewItems} />
      </aside>

      <dialog
        ref={dialogRef}
        className="library-dialog"
        aria-labelledby={titleId}
        onClose={() => {
          const opener = openerRef.current;
          openerRef.current = null;
          opener?.focus();
        }}
      >
        <h2 id={titleId}>{WEAVE.newGridAction}</h2>
        <CreateWeaveGridForm key={formKey} projectId={projectId} initialViewKind={kind} onCancel={closeCreate} />
      </dialog>
    </div>
  );
}

function GridMotif({ missing = false }: { missing?: boolean }) {
  return (
    <span className={missing ? "weave-motif weave-motif-missing" : "weave-motif"} aria-hidden="true">
      {missing ? (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M12 7v10M7 12h10" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="3" width="7.5" height="7.5" rx="1" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="1" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="1" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1" />
        </svg>
      )}
    </span>
  );
}

function ToolLink({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <Link className="weave-tool" href={href}>
      <span className="weave-tool-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="weave-tool-copy">
        <span className="weave-tool-title">{title}</span>
        <span className="weave-tool-desc">{description}</span>
      </span>
      <ChevronRightIcon />
    </Link>
  );
}

function PlanningReferences({
  base,
  projectId,
  references,
  spellingLanguage,
}: {
  base: string;
  projectId: string;
  references: PlanningReferenceGroup[];
  spellingLanguage: SpellingLanguage;
}) {
  const total = references.reduce((sum, group) => sum + group.records.length, 0);
  return (
    <Disclosure
      className="weave-references"
      summary={WEAVE.planningReferences}
      count={total}
      heading="h2"
    >
      {references.map((group) => (
        <Disclosure key={group.label} summary={group.label} count={group.records.length} heading="h3">
          {group.records.length === 0 ? (
            <p className="weave-ref-empty">{WEAVE.referencesEmpty}</p>
          ) : (
            <ul className="weave-ref-list">
              {group.records.map((record) => (
                <li key={record.id}>
                  <Link href={`${base}/records/${encodeURIComponent(record.id)}`}>{record.title}</Link>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
      ))}
      <OverflowDisclosure summary={SHELL.newRecord}>
        <h3 className="sr-only">{SHELL.newRecord}</h3>
        <NewRecordForm projectId={projectId} spellingLanguage={spellingLanguage} defaultType="chapter_outline" />
      </OverflowDisclosure>
    </Disclosure>
  );
}

function ProjectTools({ base, openReviewItems }: { base: string; openReviewItems: number }) {
  const groups = [
    {
      heading: SHELL.toolsBringIn,
      items: [
        { href: `${base}/import`, label: NAV.importPackage },
        { href: `${base}/import-markdown`, label: NAV.importMarkdown },
        { href: `${base}/import-chapters`, label: NAV.importChapters },
      ],
    },
    {
      heading: SHELL.toolsReadExport,
      items: [
        { href: `${base}/read`, label: NAV.readBook },
        { href: `${base}/export`, label: NAV.exportContext },
        { href: `${base}/export-pdf`, label: NAV.exportPdf },
      ],
    },
    {
      heading: SHELL.toolsMaintain,
      items: [
        { href: `${base}/history`, label: NAV.history, count: openReviewItems },
        { href: `${base}/dictionary`, label: NAV.dictionary },
        { href: `${base}/search`, label: NAV.projectSearch },
        { href: `${base}/cross-references`, label: NAV.crossRefCheck },
        { href: `${base}/upgrade`, label: NAV.upgradeProject },
      ],
    },
  ];
  return (
    <Disclosure className="weave-project-tools" summary={SHELL.projectTools} heading="h2">
      <ul className="weave-project-tool-list">
        <li>
          <Link href={base}>{NAV.records}</Link>
        </li>
      </ul>
      {groups.map((group) => (
        <section key={group.heading}>
          <h3>{group.heading}</h3>
          <ul className="weave-project-tool-list">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>
                  {item.label}
                  {"count" in item && item.count ? <span className="weave-ref-count">{item.count}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Disclosure>
  );
}

function Disclosure({
  summary,
  count,
  heading,
  className,
  children,
}: {
  summary: string;
  count?: number;
  heading: "h2" | "h3";
  className?: string;
  children: ReactNode;
}) {
  const uid = useId();
  const panelId = `${uid}-panel`;
  const [open, setOpen] = useState(false);
  const Tag = heading;
  return (
    <section className={className}>
      <Tag className="weave-disclose-heading">
        <button type="button" className="weave-disclose" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
          <ChevronRightIcon />
          <span>{summary}</span>
          {count !== undefined ? <span className="weave-ref-count">{count}</span> : null}
        </button>
      </Tag>
      <div id={panelId} className="weave-disclose-panel" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
