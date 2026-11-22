"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { StoryLoomMark } from "@/components/library/StoryLoomMark";
import { HELP_PATH } from "@/help/outline";
import { NAV, SHELL, THEME } from "@/ui/labels";
import type { GlobalNavId, ProjectSummary } from "@/ui/navigation";
import { nextTheme, type Theme } from "@/ui/theme";
import { formatWordCount } from "@/writing/wordCount";
import {
  AssistantIcon,
  BackupIcon,
  ConnectionsIcon,
  CollapseIcon,
  ContrastIcon,
  HelpIcon,
  MoonIcon,
  PlanIcon,
  SettingsIcon,
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

function authoringItems(projectId: string | null): NavItem[] {
  const project = (path: string) => (projectId ? `/projects/${encodeURIComponent(projectId)}${path}` : null);
  return [
    { id: "write", label: SHELL.write, icon: <WriteIcon />, href: project("/write") },
    { id: "plan", label: SHELL.plan, icon: <PlanIcon />, href: project("/plan") },
    { id: "world", label: SHELL.world, icon: <WorldIcon />, href: project("/world") },
    { id: "assistant", label: SHELL.assistant, icon: <AssistantIcon />, href: project("/assistant") },
  ];
}

function utilityItems(): NavItem[] {
  return [
    { id: "settings", label: SHELL.settings, icon: <SettingsIcon />, href: "/settings" },
    { id: "backups", label: SHELL.backups, icon: <BackupIcon />, href: "/backup" },
    { id: "connections", label: SHELL.connections, icon: <ConnectionsIcon />, href: "/connections" },
    { id: "trash", label: SHELL.trash, icon: <TrashIcon />, href: "/trash" },
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
  const items = authoringItems(current?.id ?? null);
  const utilities = utilityItems();
  const tip = variant === "rail" ? "rail-tip" : "";
  const themeName = THEME.names[theme];
  const themeChange = THEME.change(themeName, THEME.names[nextTheme(theme)]);

  return (
    <nav aria-label={SHELL.mainNav} className="global-nav">
      <Link href="/" className={`brand ${tip}`} aria-label={NAV.brand} data-tooltip={NAV.brand}>
        <StoryLoomMark className="brand-mark" />
        <span className="label brand-text" aria-hidden="true">
          {NAV.brand}
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
                  aria-current={isActive ? "true" : undefined}
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
        <Link
          href={HELP_PATH}
          className={`global-link ${tip}`}
          data-tooltip={SHELL.help}
          aria-current={active === "help" ? "page" : undefined}
        >
          <HelpIcon />
          <span className="label">{SHELL.help}</span>
        </Link>
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
        <SettingsMenu
          items={utilities}
          pathname={pathname}
          active={active}
          variant={variant}
          tip={tip}
          projects={projects}
          current={current}
        />
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
            <span className="label">{collapsed ? SHELL.expand : SHELL.collapse}</span>
          </button>
        ) : null}
      </div>
    </nav>
  );
}

function SettingsMenu({
  items,
  pathname,
  active,
  variant,
  tip,
  projects,
  current,
}: {
  items: NavItem[];
  pathname: string;
  active: GlobalNavId | null;
  variant: "rail" | "drawer";
  tip: string;
  projects: ProjectSummary[];
  current: ProjectSummary | null;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const utilityActive = items.some((item) => item.id === active);
  const focusPanel = useRef(false);

  useEffect(() => {
    if (!open || !focusPanel.current) return;
    focusPanel.current = false;
    wrapper.current?.querySelector<HTMLElement>(".settings-popover a, .settings-popover button")?.focus();
  }, [open]);

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
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  }

  return (
    <div className={`utilities-menu settings-menu ${variant}`} ref={wrapper} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={`global-link utilities-toggle ${tip}${utilityActive ? " utilities-current" : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        data-tooltip={SHELL.settings}
        onClick={() => {
          setOpen((value) => {
            if (!value) focusPanel.current = true;
            return !value;
          });
        }}
      >
        <SettingsIcon />
        <span className="label">{SHELL.settings}</span>
      </button>
      <div id={panelId} className="settings-popover" role="region" aria-label={SHELL.settings} hidden={!open}>
        <ProjectList projects={projects} current={current} onNavigate={() => setOpen(false)} />
        <ul className="global-items">
          {items.map((item) => {
            const isActive = item.id === active;
            return (
              <li key={item.id}>
                {item.href ? (
                  <Link
                    href={item.href}
                    className="utilities-link"
                    aria-current={isActive ? (pathname === item.href ? "page" : "true") : undefined}
                    onClick={() => setOpen(false)}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="settings-local">{SHELL.localOnly}</p>
      </div>
    </div>
  );
}

function projectMeta(p: ProjectSummary): string {
  return `${SHELL.chapters(p.chapterCount)} · ${formatWordCount(p.manuscriptWords)}`;
}

function ProjectList({
  projects,
  current,
  onNavigate,
}: {
  projects: ProjectSummary[];
  current: ProjectSummary | null;
  onNavigate: () => void;
}) {
  const listId = useId();
  const workspaces: { id: string; name: string; projects: ProjectSummary[] }[] = [];
  for (const p of projects) {
    let w = workspaces.find((x) => x.id === p.workspaceId);
    if (!w) workspaces.push((w = { id: p.workspaceId, name: p.workspaceName, projects: [] }));
    w.projects.push(p);
  }

  return (
    <div className="selector-popover settings-projects">
      <p className="settings-kicker" id={`${listId}-label`}>
        {SHELL.switchProject}
      </p>
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
                  onClick={onNavigate}
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
      <Link href="/" className="selector-all" onClick={onNavigate}>
        {SHELL.allWorkspaces}
      </Link>
    </div>
  );
}
