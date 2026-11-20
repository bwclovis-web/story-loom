"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useMemo, useState } from "react";
import {
  MarkRewriteCompleteButton,
  StartAuthorRewriteButton,
  WriteDraftSwitcher,
  type DraftOption,
} from "@/components/drafts/DraftControls";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { ANALYZE, DRAFT, NAV, SHELL, WEAVE, WRITE } from "@/ui/labels";
import { groupForProjectPath, parseProjectPath, RECORD_GROUPS, type RecordNavEntry } from "@/ui/navigation";
import { IconButton } from "@/components/ui/IconButton";
import { CollapsibleNavSection } from "./CollapsibleNavSection";
import { Drawer } from "./Drawer";
import { PanelLeftIcon } from "./icons";
import { useLayout } from "./LayoutContext";
import { ManuscriptTree } from "./ManuscriptTree";
import { PanelResizer } from "./PanelResizer";
import { WorldNav } from "./WorldNav";

interface ProjectInfo {
  id: string;
  title: string;
  workspaceName: string;
}

const COLUMN_ID = "project-column";

export function ProjectNav({
  project,
  records,
  openReviewItems,
  drafts = [],
  activeDraftId = null,
  boards = [],
  maps = [],
}: {
  project: ProjectInfo;
  records: RecordNavEntry[];
  openReviewItems: number;
  drafts?: DraftOption[];
  activeDraftId?: string | null;
  boards?: Array<{ id: string; title: string }>;
  maps?: Array<{ id: string; title: string }>;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const { layout, updateLayout } = useLayout();
  const typeOf = useMemo(() => {
    const types = new Map(records.map((r) => [r.id, r.type]));
    return (id: string) => types.get(id);
  }, [records]);
  const parsed = parseProjectPath(pathname);
  const writeHome = parsed?.rest.length === 1 && parsed.rest[0] === "write";
  const writing = parsed ? groupForProjectPath(parsed.rest, typeOf) === "write" : false;
  const showLabel = writing ? WRITE.showNavigation : WRITE.showProjectPanel;
  const hideLabel = writing ? WRITE.hideNavigation : WRITE.hideProjectPanel;
  const contentProps = {
    project,
    records,
    openReviewItems,
    pathname,
    drafts,
    activeDraftId,
    boards,
    maps,
    collapsed,
    onToggleSection: toggleSection,
  };

  const secondaryOpen = !layout.secondaryHidden;
  if (writeHome) return null;

  return (
    <>
      <div
        className="project-column"
        id={COLUMN_ID}
        data-open={secondaryOpen ? "" : undefined}
        aria-hidden={!secondaryOpen}
        inert={!secondaryOpen ? true : undefined}
      >
        <ProjectNavContent
          {...contentProps}
          hideButton={
            <IconButton
              tip="end"
              className="panel-toggle"
              aria-label={hideLabel}
              aria-controls={COLUMN_ID}
              aria-expanded={secondaryOpen}
              onClick={() => updateLayout({ secondaryHidden: true })}
            >
              <PanelLeftIcon />
            </IconButton>
          }
        />
      </div>
      {/* Resizer stays mounted (like the context rail) so width can animate without a layout jump. */}
      <PanelResizer
        panel="secondaryWidth"
        controls={COLUMN_ID}
        label={writing ? WRITE.resizeNavigation : SHELL.projectNav}
        hidden={!secondaryOpen}
      />
      <div className="panel-strip left" data-open={!secondaryOpen ? "" : undefined} aria-hidden={secondaryOpen}>
        <IconButton
          tip="right"
          className="panel-toggle"
          aria-label={showLabel}
          aria-controls={COLUMN_ID}
          aria-expanded={secondaryOpen}
          tabIndex={secondaryOpen ? -1 : undefined}
          onClick={() => updateLayout({ secondaryHidden: false })}
        >
          <PanelLeftIcon />
        </IconButton>
      </div>
      <div className="project-bar">
        <button
          type="button"
          className="secondary project-bar-button"
          aria-expanded={drawerOpen}
          aria-controls="project-drawer"
          onClick={() => setDrawerOpen(true)}
        >
          {SHELL.openProjectMenu}
          <span className="project-bar-title">{project.title}</span>
        </button>
      </div>
      <Drawer
        id="project-drawer"
        label={SHELL.projectNav}
        closeLabel={SHELL.closeProjectMenu}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        <ProjectNavContent {...contentProps} />
      </Drawer>
    </>
  );
}

function ProjectNavContent({
  project,
  records,
  openReviewItems,
  pathname,
  drafts,
  activeDraftId,
  boards = [],
  maps = [],
  collapsed,
  onToggleSection,
  hideButton,
}: {
  project: ProjectInfo;
  records: RecordNavEntry[];
  openReviewItems: number;
  pathname: string;
  drafts: DraftOption[];
  activeDraftId: string | null;
  boards?: Array<{ id: string; title: string }>;
  maps?: Array<{ id: string; title: string }>;
  collapsed: ReadonlySet<string>;
  onToggleSection: (key: string) => void;
  hideButton?: React.ReactNode;
}) {
  const base = `/projects/${encodeURIComponent(project.id)}`;
  const parsed = parseProjectPath(pathname);
  const typeOf = useMemo(() => {
    const types = new Map(records.map((r) => [r.id, r.type]));
    return (id: string) => types.get(id);
  }, [records]);
  const group = parsed ? groupForProjectPath(parsed.rest, typeOf) : null;
  const currentRecordId = parsed?.rest[0] === "records" ? (parsed.rest[1] ?? null) : null;
  const current = (href: string) => (pathname === href ? "page" : undefined);
  const idPrefix = useId();
  const activeDraft = drafts.find((d) => d.id === activeDraftId) ?? null;
  const hasAuthor = drafts.some((d) => d.kind === "author_manuscript");
  const showStart = group === "write" && !hasAuthor;

  const toolGroups = [
    {
      id: "bring-in",
      heading: SHELL.toolsBringIn,
      items: [
        { href: `${base}/import`, label: NAV.importPackage },
        { href: `${base}/import-markdown`, label: NAV.importMarkdown },
        { href: `${base}/import-chapters`, label: NAV.importChapters },
      ],
    },
    {
      id: "read-export",
      heading: SHELL.toolsReadExport,
      items: [
        { href: `${base}/read`, label: NAV.readBook },
        { href: `${base}/export`, label: NAV.exportContext },
        { href: `${base}/export-pdf`, label: NAV.exportPdf },
      ],
    },
    {
      id: "maintain",
      heading: SHELL.toolsMaintain,
      items: [
        { href: `${base}/history`, label: NAV.history, count: openReviewItems },
        { href: `${base}/dictionary`, label: NAV.dictionary },
        { href: `${base}/cross-references`, label: NAV.crossRefCheck },
        { href: `${base}/upgrade`, label: NAV.upgradeProject },
      ],
    },
  ] as const;

  return (
    <nav aria-label={SHELL.projectNav} className="project-nav">
      <div className="project-head">
        <div className="project-head-text">
          <p className="project-title">{project.title}</p>
          <p className="project-workspace">{project.workspaceName}</p>
        </div>
        {hideButton}
      </div>
      <ul className="nav-list">
        <li>
          <Link href={base} aria-current={current(base)}>
            {NAV.records}
            <span className="nav-count">{records.length}</span>
          </Link>
        </li>
      </ul>

      {group === "write" && drafts.length > 0 ? (
        <div className="nav-section draft-nav">
          <p className="nav-subheading">{DRAFT.heading}</p>
          <WriteDraftSwitcher projectId={project.id} drafts={drafts} activeDraftId={activeDraftId} />
          {activeDraft?.kind === "author_manuscript" ? (
            <div className="row" style={{ marginTop: "0.5rem" }}>
              <MarkRewriteCompleteButton
                projectId={project.id}
                draftId={activeDraft.id}
                completed={!!activeDraft.completedAt}
              />
            </div>
          ) : null}
          {showStart ? <StartAuthorRewriteButton projectId={project.id} /> : null}
        </div>
      ) : null}
      {group === "write" && drafts.length === 0 ? (
        <div className="nav-section draft-nav">
          <p className="nav-subheading">{DRAFT.heading}</p>
          <StartAuthorRewriteButton projectId={project.id} />
        </div>
      ) : null}

      {group === "write" ? (
        <ManuscriptTree
          projectId={project.id}
          records={records}
          currentRecordId={currentRecordId}
          draftId={activeDraftId}
        />
      ) : group === "world" ? (
        <WorldNav
          projectId={project.id}
          records={records}
          onWorldPage={parsed?.rest[0] === "world"}
          currentRecordId={currentRecordId}
          boards={boards}
          maps={maps}
          collapsed={collapsed}
          onToggleSection={onToggleSection}
        />
      ) : group === "plan" ? (
        <>
          <CollapsibleNavSection
            sectionKey="weave"
            collapsed={collapsed}
            onToggle={onToggleSection}
            headingId={`${idPrefix}-weave`}
            heading={WEAVE.heading}
          >
            <ul className="nav-list" aria-labelledby={`${idPrefix}-weave`}>
              <li>
                <Link
                  href={`${base}/plan/weave`}
                  aria-current={pathname.includes("/plan/weave") && !pathname.includes("/templates") ? "page" : undefined}
                >
                  {WEAVE.heading}
                </Link>
              </li>
              <li>
                <Link
                  href={`${base}/plan/weave/templates`}
                  aria-current={pathname.includes("/plan/weave/templates") ? "page" : undefined}
                >
                  {WEAVE.templates}
                </Link>
              </li>
              <li>
                <Link
                  href={`${base}/analyze`}
                  aria-current={pathname.includes("/analyze") ? "page" : undefined}
                >
                  {ANALYZE.heading}
                </Link>
              </li>
            </ul>
          </CollapsibleNavSection>
          {RECORD_GROUPS.plan.map((type) => {
            const ofType = records.filter((r) => r.type === type);
            const headingId = `${idPrefix}-${type}`;
            return (
              <CollapsibleNavSection
                key={type}
                sectionKey={`type:${type}`}
                collapsed={collapsed}
                onToggle={onToggleSection}
                headingId={headingId}
                heading={RECORD_TYPE_LABELS[type]}
                count={ofType.length}
              >
                {ofType.length === 0 ? (
                  <p className="nav-empty">None yet</p>
                ) : (
                  <ul className="nav-list record-list" aria-labelledby={headingId}>
                    {ofType.map((r) => (
                      <li key={r.id}>
                        <Link href={`${base}/records/${encodeURIComponent(r.id)}`} aria-current={r.id === currentRecordId ? "page" : undefined}>
                          {r.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CollapsibleNavSection>
            );
          })}
        </>
      ) : null}

      <p className="nav-heading" id={`${idPrefix}-tools`}>
        {SHELL.projectTools}
      </p>
      {toolGroups.map((group) => {
        const headingId = `${idPrefix}-tools-${group.id}`;
        return (
          <CollapsibleNavSection
            key={group.id}
            sectionKey={`tools:${group.id}`}
            collapsed={collapsed}
            onToggle={onToggleSection}
            headingId={headingId}
            heading={group.heading}
          >
            <ul className="nav-list" aria-labelledby={headingId}>
              {group.items.map((t) => (
                <li key={t.href}>
                  <Link href={t.href} aria-current={current(t.href)}>
                    {t.label}
                    {"count" in t && t.count ? (
                      <span className="nav-count attention">
                        <span aria-hidden="true">{t.count}</span>
                        <span className="sr-only">, {SHELL.openReviewItems(t.count)}</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </CollapsibleNavSection>
        );
      })}
    </nav>
  );
}
