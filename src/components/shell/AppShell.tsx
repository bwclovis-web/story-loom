"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { RecordType } from "@/domain/recordTypes";
import { NAV, SHELL } from "@/ui/labels";
import { activeGlobalItem, parseProjectPath, resolveNavProjectId, type ProjectSummary } from "@/ui/navigation";
import { THEME_COOKIE, type Theme } from "@/ui/theme";
import { StoryLoomMark } from "@/components/library/StoryLoomMark";
import { IconButton } from "@/components/ui/IconButton";
import { Drawer } from "./Drawer";
import { GlobalNav } from "./GlobalNav";
import { MenuIcon } from "./icons";
import { LayoutContext, WIDTH_VARIABLES, type LayoutControls } from "./LayoutContext";
import type { WriteMode } from "@/writing/writeMode";
import {
  LAYOUT_COOKIE,
  NAV_COOKIE,
  PROJECT_COOKIE,
  writePreference,
  type LayoutPreference,
  type NavPreference,
} from "./preferences";
import { confirmLeave, isLeavingClick } from "./unsaved";

/** Below this width an "auto" navigation shows icons only; matches globals.css. */
const MEDIUM_QUERY = "(max-width: 1179px)";

export function AppShell({
  projects,
  recordTypes,
  initialNav,
  initialProjectId,
  initialLayout,
  initialTheme,
  children,
}: {
  projects: ProjectSummary[];
  recordTypes: [string, RecordType][];
  initialNav: NavPreference;
  initialProjectId: string | null;
  initialLayout: LayoutPreference;
  initialTheme: Theme;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [navPreference, setNavPreference] = useState<NavPreference>(initialNav);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [medium, setMedium] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lastProjectId, setLastProjectId] = useState(initialProjectId);
  const [layout, setLayout] = useState(initialLayout);
  const [writeScreen, setWriteScreen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const writeMode: WriteMode = layout.writeMode;

  useEffect(() => {
    const query = window.matchMedia(MEDIUM_QUERY);
    const update = () => setMedium(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    // Capture on window runs before Next.js links handle the click.
    const onClick = (event: MouseEvent) => {
      if (isLeavingClick(event) && !confirmLeave()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  const pathProjectId = parseProjectPath(pathname)?.projectId ?? null;
  const knownPathProject = pathProjectId && projects.some((p) => p.id === pathProjectId) ? pathProjectId : null;
  useEffect(() => {
    if (knownPathProject && knownPathProject !== lastProjectId) {
      setLastProjectId(knownPathProject);
      writePreference(PROJECT_COOKIE, knownPathProject);
    }
  }, [knownPathProject, lastProjectId]);

  const navProjectId = resolveNavProjectId(pathname, projects, knownPathProject ?? lastProjectId);
  const current = projects.find((p) => p.id === navProjectId) ?? null;
  const typeOf = useMemo(() => {
    const types = new Map(recordTypes);
    return (id: string) => types.get(id);
  }, [recordTypes]);
  const active = activeGlobalItem(pathname, typeOf);

  const collapsed = navPreference === "auto" ? medium : navPreference === "collapsed";
  function toggleCollapsed() {
    const next = collapsed ? "expanded" : "collapsed";
    setNavPreference(next);
    writePreference(NAV_COOKIE, next);
  }

  const updateLayout = useCallback((patch: Partial<LayoutPreference>) => {
    setLayout((prev) => {
      const next = { ...prev, ...patch };
      writePreference(LAYOUT_COOKIE, JSON.stringify(next));
      return next;
    });
  }, []);
  const previewWidth = useCallback((key: keyof typeof WIDTH_VARIABLES, px: number) => {
    shellRef.current?.style.setProperty(WIDTH_VARIABLES[key], `${px}px`);
  }, []);
  const setWriteMode = useCallback((mode: WriteMode) => updateLayout({ writeMode: mode }), [updateLayout]);
  const openMainMenu = useCallback(() => setDrawerOpen(true), []);
  const controls = useMemo<LayoutControls>(
    () => ({ layout, updateLayout, previewWidth, writeMode, setWriteMode, writeScreen, setWriteScreen, openMainMenu }),
    [layout, updateLayout, previewWidth, writeMode, setWriteMode, writeScreen, openMainMenu],
  );

  function changeTheme(next: Theme) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    writePreference(THEME_COOKIE, next);
  }

  const navProps = { pathname, active, projects, current, navProjectId, theme, onChangeTheme: changeTheme };
  const style = {
    [WIDTH_VARIABLES.secondaryWidth]: `${layout.secondaryWidth}px`,
    [WIDTH_VARIABLES.contextWidth]: `${layout.contextWidth}px`,
  } as CSSProperties;

  return (
    <LayoutContext.Provider value={controls}>
      <div
        ref={shellRef}
        className="app-shell"
        data-nav={navPreference}
        data-write={writeScreen ? "on" : undefined}
        data-write-mode={writeScreen ? writeMode : undefined}
        data-focus={writeScreen && writeMode === "focus" ? "on" : undefined}
        data-write-split={
          writeScreen && layout.writeSplitRecordId && writeMode !== "companion" ? "on" : undefined
        }
        data-typewriter={writeScreen && writeMode === "focus" && layout.typewriterScroll ? "on" : undefined}
        data-secondary={layout.secondaryHidden ? "hidden" : undefined}
        style={style}
      >
        <a className="skip-link" href="#main">
          {SHELL.skipToContent}
        </a>

        <div className="mobile-bar">
          <IconButton
            aria-label={SHELL.openMenu}
            aria-expanded={drawerOpen}
            aria-controls="global-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </IconButton>
          <Link href="/" className="brand" aria-label={NAV.brand}>
            <StoryLoomMark className="brand-mark" />
            <span className="brand-text" aria-hidden="true">
              {NAV.brand}
            </span>
          </Link>
        </div>

        <div className="global-rail" id="global-rail">
          <GlobalNav variant="rail" {...navProps} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
        </div>

        <Drawer
          id="global-drawer"
          label={SHELL.mainNav}
          closeLabel={SHELL.closeMenu}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          dark
        >
          <GlobalNav variant="drawer" {...navProps} />
        </Drawer>

        <div className="app-body">{children}</div>
      </div>
    </LayoutContext.Provider>
  );
}
