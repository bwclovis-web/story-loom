"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { HELP_PATH } from "@/help/outline";
import { NAV, SHELL, THEME } from "@/ui/labels";
import type { GlobalNavId, ProjectSummary } from "@/ui/navigation";
import { nextTheme, type Theme } from "@/ui/theme";
import { formatWordCount } from "@/writing/wordCount";
import {
  AssistantIcon,
  BackupIcon,
  BookIcon,
  ConnectionsIcon,
  ChevronIcon,
  CollapseIcon,
  ContrastIcon,
  HelpIcon,
  MoonIcon,
  PlanIcon,
  SunIcon,
  TrashIcon,
  WorldIcon,
  WriteIcon,
} from "./icons";

interface NavItem {
  id: GlobalNavId;
  label: string;
  icon: ReactNode;
  /** Null when the destination needs a project and none is open. */
  href: string | null;
}

function navItems(projectId: string | null): NavItem[] {
  const project = (path: string) => (projectId ? `/projects/${encodeURIComponent(projectId)}${path}` : null);
  return [
    { id: "write", label: SHELL.write, icon: <WriteIcon />, href: project("/write") },
    { id: "plan", label: SHELL.plan, icon: <PlanIcon />, href: project("/plan") },
    { id: "world", label: SHELL.world, icon: <WorldIcon />, href: project("/world") },
    { id: "assistant", label: SHELL.assistant, icon: <AssistantIcon />, href: project("/assistant") },
    { id: "backups", label: SHELL.backups, icon: <BackupIcon />, href: "/backup" },
    { id: "connections", label: SHELL.connections, icon: <ConnectionsIcon />, href: "/connections" },
    { id: "trash", label: SHELL.trash, icon: <TrashIcon />, href: "/trash" },
    { id: "help", label: SHELL.help, icon: <HelpIcon />, href: HELP_PATH },
  ];
}

export function GlobalNav({
  variant,
  pathname,
  active,
  projects,
  current,
  theme,
  onChangeTheme,
  collapsed,
  onToggleCollapsed,
}: {
  variant: "rail" | "drawer";
  pathname: string;
  active: GlobalNavId | null;
  projects: ProjectSummary[];
  current: ProjectSummary | null;
  theme: Theme;
  onChangeTheme: (theme: Theme) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const items = navItems(current?.id ?? null);
  const tip = variant === "rail" ? "rail-tip" : "";
  const themeName = THEME.names[theme];
  const themeChange = THEME.change(themeName, THEME.names[nextTheme(theme)]);

  return (
    <nav aria-label={SHELL.mainNav} className="global-nav">
      <Link href="/" className={`brand ${tip}`} aria-label={NAV.brand} data-tooltip={NAV.brand}>
        <span className="brand-mark" aria-hidden="true">
          S
        </span>
        <span className="label brand-text" aria-hidden="true">
          Story<span className="brand-accent">Loom</span>
        </span>
      </Link>

      <ul className="global-items">
        {items.map((item) => {
          const isActive = item.id === active;
          return (
            <li key={item.id}>
              {item.href ? (
                <Link
                  href={item.href}
                  className={`global-link ${tip}`}
                  data-tooltip={item.label}
                  aria-current={isActive ? (pathname === item.href ? "page" : "true") : undefined}
                >
                  {item.icon}
                  <span className="label">{item.label}</span>
                </Link>
              ) : (
                <span
                  className={`global-link disabled ${tip}`}
                  aria-disabled="true"
                  data-tooltip={`${item.label} (${SHELL.needsProject})`}
                >
                  {item.icon}
                  <span className="label">
                    {item.label}
                    <span className="sr-only"> ({SHELL.needsProject})</span>
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {current ? null : (
        <p className="label nav-note" aria-hidden="true">
          Open a project to use {SHELL.write}, {SHELL.plan}, {SHELL.world} and {SHELL.assistant}.
        </p>
      )}

      <div className="global-footer">
        <ProjectSelector projects={projects} current={current} variant={variant} />
        <p className="label local-note">{SHELL.localOnly}</p>
        <button
          type="button"
          className={`theme-toggle ${tip}`}
          aria-label={themeChange}
          data-tooltip={themeChange}
          onClick={() => onChangeTheme(nextTheme(theme))}
        >
          {theme === "light" ? <SunIcon /> : theme === "dark" ? <MoonIcon /> : <ContrastIcon />}
          <span className="label" aria-hidden="true">
            {THEME.current(themeName)}
          </span>
        </button>
        {variant === "rail" && onToggleCollapsed ? (
          <button
            type="button"
            className={`collapse-toggle ${tip}`}
            aria-expanded={!collapsed}
            aria-controls="global-rail"
            aria-label={collapsed ? SHELL.expand : SHELL.collapse}
            data-tooltip={collapsed ? SHELL.expand : SHELL.collapse}
            onClick={onToggleCollapsed}
          >
            <CollapseIcon />
            <span className="label" aria-hidden="true">
              {SHELL.collapse}
            </span>
          </button>
        ) : null}
      </div>
    </nav>
  );
}

function projectMeta(p: ProjectSummary): string {
  return `${SHELL.chapters(p.chapterCount)} · ${formatWordCount(p.manuscriptWords)}`;
}

function ProjectSelector({
  projects,
  current,
  variant,
}: {
  projects: ProjectSummary[];
  current: ProjectSummary | null;
  variant: "rail" | "drawer";
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) {
      // Keep Escape from also closing a surrounding drawer.
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  }

  const workspaces: { id: string; name: string; projects: ProjectSummary[] }[] = [];
  for (const p of projects) {
    let w = workspaces.find((x) => x.id === p.workspaceId);
    if (!w) workspaces.push((w = { id: p.workspaceId, name: p.workspaceName, projects: [] }));
    w.projects.push(p);
  }

  const title = current ? current.title : SHELL.chooseProject;
  const meta = current ? `${current.workspaceName} · ${projectMeta(current)}` : SHELL.projects(projects.length);

  return (
    <div className={`project-selector ${variant}`} ref={wrapper} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={`selector-button ${variant === "rail" ? "rail-tip" : ""}`}
        aria-expanded={open}
        aria-controls={listId}
        data-tooltip={`${SHELL.switchProject}: ${title}`}
        onClick={() => setOpen((o) => !o)}
      >
        <BookIcon />
        <span className="label selector-text">
          <span className="selector-title">{title}</span>
          <span className="selector-meta">{meta}</span>
        </span>
        <span className="label selector-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
        <span className="sr-only">, {SHELL.switchProject}</span>
      </button>
      <div id={listId} className="selector-popover" hidden={!open}>
        {workspaces.length === 0 ? <p className="muted small">No projects yet.</p> : null}
        {workspaces.map((w) => (
          <div key={w.id} className="selector-group">
            <p className="selector-workspace" id={`${listId}-${w.id}`}>
              {w.name}
            </p>
            <ul aria-labelledby={`${listId}-${w.id}`}>
              {w.projects.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${encodeURIComponent(p.id)}`}
                    aria-current={p.id === current?.id ? "true" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    <span className="selector-project">{p.title}</span>
                    <span className="selector-project-meta">
                      {projectMeta(p)} · {SHELL.records(p.recordCount)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <Link href="/" className="selector-all" onClick={() => setOpen(false)}>
          {SHELL.allWorkspaces}
        </Link>
      </div>
    </div>
  );
}
