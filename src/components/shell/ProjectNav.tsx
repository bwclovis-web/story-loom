"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { NAV, SHELL, WRITE } from "@/ui/labels";
import { groupForProjectPath, parseProjectPath, RECORD_GROUPS, type RecordNavEntry } from "@/ui/navigation";
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
}: {
  project: ProjectInfo;
  records: RecordNavEntry[];
  openReviewItems: number;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { layout, updateLayout } = useLayout();
  const typeOf = useMemo(() => {
    const types = new Map(records.map((r) => [r.id, r.type]));
    return (id: string) => types.get(id);
  }, [records]);
  const parsed = parseProjectPath(pathname);
  const writing = parsed ? groupForProjectPath(parsed.rest, typeOf) === "write" : false;
  const showLabel = writing ? WRITE.showNavigation : WRITE.showProjectPanel;
  const hideLabel = writing ? WRITE.hideNavigation : WRITE.hideProjectPanel;
  const contentProps = { project, records, openReviewItems, pathname };

  return (
    <>
      <div className="project-column" id={COLUMN_ID} hidden={layout.secondaryHidden}>
        <ProjectNavContent
          {...contentProps}
          hideButton={
            <button
              type="button"
              className="icon-button tip tip-end panel-toggle"
              aria-label={hideLabel}
              data-tooltip={hideLabel}
              aria-controls={COLUMN_ID}
              aria-expanded="true"
              onClick={() => updateLayout({ secondaryHidden: true })}
            >
              <PanelLeftIcon />
            </button>
          }
        />
      </div>
      {layout.secondaryHidden ? (
        <div className="panel-strip left">
          <button
            type="button"
            className="icon-button tip-right panel-toggle"
            aria-label={showLabel}
            data-tooltip={showLabel}
            aria-controls={COLUMN_ID}
            aria-expanded="false"
            onClick={() => updateLayout({ secondaryHidden: false })}
          >
            <PanelLeftIcon />
          </button>
        </div>
      ) : (
        <PanelResizer panel="secondaryWidth" controls={COLUMN_ID} label={writing ? WRITE.resizeNavigation : SHELL.projectNav} />
      )}
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
  hideButton,
}: {
  project: ProjectInfo;
  records: RecordNavEntry[];
  openReviewItems: number;
  pathname: string;
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

  const tools = [
    { href: `${base}/import`, label: NAV.importPackage },
    { href: `${base}/import-markdown`, label: NAV.importMarkdown },
    { href: `${base}/import-chapters`, label: NAV.importChapters },
    { href: `${base}/read`, label: NAV.readBook },
    { href: `${base}/export`, label: NAV.exportContext },
    { href: `${base}/export-pdf`, label: NAV.exportPdf },
    { href: `${base}/history`, label: NAV.history, count: openReviewItems },
    { href: `${base}/dictionary`, label: NAV.dictionary },
    { href: `${base}/cross-references`, label: NAV.crossRefCheck },
  ];

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

      {group === "write" ? (
        <ManuscriptTree projectId={project.id} records={records} currentRecordId={currentRecordId} />
      ) : group === "world" ? (
        <WorldNav projectId={project.id} records={records} onWorldPage={parsed?.rest[0] === "world"} currentRecordId={currentRecordId} />
      ) : group ? (
        RECORD_GROUPS[group].map((type) => {
          const ofType = records.filter((r) => r.type === type);
          const headingId = `${idPrefix}-${type}`;
          return (
            <div key={type} className="nav-section">
              <p className="nav-subheading" id={headingId}>
                {RECORD_TYPE_LABELS[type]}
                <span className="nav-count">{ofType.length}</span>
              </p>
              {ofType.length === 0 ? (
                <p className="nav-empty">None yet</p>
              ) : (
                <ul className="nav-list record-list" aria-labelledby={headingId}>
                  {ofType.map((r) => {
                    const href = `${base}/records/${encodeURIComponent(r.id)}`;
                    return (
                      <li key={r.id}>
                        <Link href={href} aria-current={current(href)}>
                          {r.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })
      ) : null}

      <p className="nav-heading" id={`${idPrefix}-tools`}>
        {SHELL.projectTools}
      </p>
      <ul className="nav-list" aria-labelledby={`${idPrefix}-tools`}>
        {tools.map((t) => (
          <li key={t.href}>
            <Link href={t.href} aria-current={current(t.href)}>
              {t.label}
              {t.count ? (
                <span className="nav-count attention">
                  <span aria-hidden="true">{t.count}</span>
                  <span className="sr-only">, {SHELL.openReviewItems(t.count)}</span>
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
