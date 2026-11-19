/*
 * Presentation preferences kept in this browser as cookies, so the server can
 * render the first paint without a layout jump. They hold layout choices and a
 * project ID only, never record text.
 */

export const NAV_COOKIE = "wordly-nav";
export const PROJECT_COOKIE = "wordly-project";
export const LAYOUT_COOKIE = "wordly-layout";
/** Active Write manuscript draft for this browser (draft id, or empty when unset). */
export const WRITE_DRAFT_COOKIE = "wordly-write-draft";

/**
 * Optional guided walkthrough. Cookie values (this browser only):
 * - missing / empty → checklist open at task 0
 * - `open:N` or legacy `step:N` → checklist open at task N
 * - `paused:N` → Skip for now; Resume restores open at N
 * - `dismissed`, `done`, or a legacy version string → permanent dismiss
 */
export const ONBOARDING_COOKIE = "wordly-onboarding";
/** Bump when walkthrough tasks change so authors see the new guide once. */
export const ONBOARDING_VERSION = "storyloom-simple-2026-11";

export type WalkthroughState =
  | { kind: "open"; step: number }
  | { kind: "paused"; step: number }
  | { kind: "dismissed" };

export function parseWalkthroughCookie(raw: string | undefined): WalkthroughState {
  if (!raw) return { kind: "open", step: 0 };
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  if (
    value === "dismissed" ||
    value === "done" ||
    value === ONBOARDING_VERSION ||
    value === "storyloom-walk-2026-11" ||
    value === "storyloom-2026-11"
  ) {
    return { kind: "dismissed" };
  }
  const openMatch = /^(?:open|step):(\d+)$/.exec(value);
  if (openMatch) {
    return { kind: "open", step: Number(openMatch[1]) };
  }
  const pausedMatch = /^paused:(\d+)$/.exec(value);
  if (pausedMatch) {
    return { kind: "paused", step: Number(pausedMatch[1]) };
  }
  return { kind: "dismissed" };
}

export function walkthroughCookieValue(state: WalkthroughState): string {
  if (state.kind === "dismissed") return "dismissed";
  if (state.kind === "paused") return `paused:${state.step}`;
  return `open:${state.step}`;
}

/** "auto" collapses the navigation on medium-width windows and expands it on wide ones. */
export type NavPreference = "auto" | "collapsed" | "expanded";

export function parseNavPreference(value: string | undefined): NavPreference {
  return value === "collapsed" || value === "expanded" ? value : "auto";
}

export function writePreference(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

/** Pixel limits for the resizable side panels. */
export const SECONDARY_WIDTH = { min: 208, max: 360, initial: 240 } as const;
export const CONTEXT_WIDTH = { min: 288, max: 480, initial: 328 } as const;

export const CONTEXT_TABS = ["source", "references", "notes", "proofread"] as const;
export type ContextTab = (typeof CONTEXT_TABS)[number];

export function parseWriteDraftPreference(value: string | undefined): string | null {
  if (!value) return null;
  const raw = value.startsWith("%") ? decodeURIComponent(value) : value;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

export interface LayoutPreference {
  secondaryWidth: number;
  contextWidth: number;
  secondaryHidden: boolean;
  contextHidden: boolean;
  contextTab: ContextTab;
}

export const DEFAULT_LAYOUT: LayoutPreference = {
  secondaryWidth: SECONDARY_WIDTH.initial,
  contextWidth: CONTEXT_WIDTH.initial,
  secondaryHidden: false,
  contextHidden: false,
  contextTab: "references",
};

export function clampWidth(value: number, limits: { min: number; max: number }): number {
  return Math.round(Math.min(limits.max, Math.max(limits.min, value)));
}

export function parseLayoutPreference(value: string | undefined): LayoutPreference {
  if (!value) return DEFAULT_LAYOUT;
  let raw: Partial<Record<keyof LayoutPreference, unknown>>;
  try {
    raw = JSON.parse(value.startsWith("%") ? decodeURIComponent(value) : value) as typeof raw;
  } catch {
    return DEFAULT_LAYOUT;
  }
  if (!raw || typeof raw !== "object") return DEFAULT_LAYOUT;
  const width = (v: unknown, limits: typeof SECONDARY_WIDTH | typeof CONTEXT_WIDTH) =>
    typeof v === "number" && Number.isFinite(v) ? clampWidth(v, limits) : limits.initial;
  return {
    secondaryWidth: width(raw.secondaryWidth, SECONDARY_WIDTH),
    contextWidth: width(raw.contextWidth, CONTEXT_WIDTH),
    secondaryHidden: raw.secondaryHidden === true,
    contextHidden: raw.contextHidden === true,
    contextTab: (CONTEXT_TABS as readonly unknown[]).includes(raw.contextTab) ? (raw.contextTab as ContextTab) : "references",
  };
}
