import { CHARACTER_DEVELOPMENT, CONTINUITY, SHELL, WORLD } from "@/ui/labels";
import { parseProjectPath } from "@/ui/navigation";

/**
 * One registry for World surfaces. Desktop navigation, the narrow-screen
 * World sections drawer, the References hub directory, and breadcrumb labels
 * all read this list. Adding a surface here is what makes it reachable.
 */

export type WorldDestinationKey =
  | "references"
  | "relationships"
  | "maps"
  | "boards"
  | "events"
  | "calendar"
  | "names"
  | "continuity"
  | "development";

export type WorldDestinationGroupId = "lore" | "visual" | "time" | "tools";

export interface WorldDestination {
  key: WorldDestinationKey;
  group: WorldDestinationGroupId;
  /** Path segment after `/world`. Empty for the References hub. */
  segment: string;
  label: string;
  hint: string;
}

export interface WorldDestinationGroup {
  id: WorldDestinationGroupId;
  heading: string;
  keys: readonly WorldDestinationKey[];
}

const DESTINATIONS: readonly WorldDestination[] = [
  {
    key: "references",
    group: "lore",
    segment: "",
    label: WORLD.references,
    hint: WORLD.referencesHint,
  },
  {
    key: "relationships",
    group: "lore",
    segment: "relationships",
    label: WORLD.relationships,
    hint: WORLD.relationshipsNavHint,
  },
  {
    key: "development",
    group: "lore",
    segment: "development",
    label: CHARACTER_DEVELOPMENT.heading,
    hint: CHARACTER_DEVELOPMENT.seriesLead,
  },
  {
    key: "maps",
    group: "visual",
    segment: "maps",
    label: WORLD.maps,
    hint: WORLD.mapsNavHint,
  },
  {
    key: "boards",
    group: "visual",
    segment: "boards",
    label: WORLD.boards,
    hint: WORLD.boardsNavHint,
  },
  {
    key: "events",
    group: "time",
    segment: "events",
    label: WORLD.storyTimeline,
    hint: WORLD.storyTimelineHint,
  },
  {
    key: "calendar",
    group: "time",
    segment: "calendar",
    label: WORLD.worldCalendar,
    hint: WORLD.worldCalendarHint,
  },
  {
    key: "names",
    group: "tools",
    segment: "names",
    label: WORLD.nameGenerator,
    hint: WORLD.nameGeneratorNavHint,
  },
  {
    key: "continuity",
    group: "time",
    segment: "continuity",
    label: CONTINUITY.nav,
    hint: CONTINUITY.navHint,
  },
];

export const WORLD_DESTINATIONS: readonly WorldDestination[] = DESTINATIONS;

export const WORLD_DESTINATION_GROUPS: readonly WorldDestinationGroup[] = [
  { id: "lore", heading: WORLD.loreAndCodex, keys: ["references", "relationships", "development"] },
  { id: "visual", heading: WORLD.visualSpaces, keys: ["maps", "boards"] },
  { id: "time", heading: WORLD.timeAndContinuity, keys: ["events", "calendar", "continuity"] },
  { id: "tools", heading: WORLD.toolsHeading, keys: ["names"] },
];

export function worldDestinationByKey(key: WorldDestinationKey): WorldDestination {
  const found = DESTINATIONS.find((item) => item.key === key);
  if (!found) throw new Error(`Unknown World destination ${key}`);
  return found;
}

export function worldDestinationsInGroup(group: WorldDestinationGroup): WorldDestination[] {
  return group.keys.map((key) => worldDestinationByKey(key));
}

export function worldDestinationHref(projectId: string, key: WorldDestinationKey): string {
  const destination = worldDestinationByKey(key);
  if (destination.key === "continuity") return `/projects/${encodeURIComponent(projectId)}/continuity`;
  const base = `/projects/${encodeURIComponent(projectId)}/world`;
  return destination.segment ? `${base}/${destination.segment}` : base;
}

export interface WorldDestinationMatch {
  key: WorldDestinationKey;
  /** True on the surface's own page. False on a nested map, board, or reference record. */
  exact: boolean;
}

/**
 * Which World surface a URL belongs to.
 * Query parameters do not change the surface: `/world?type=…` is still References.
 * A world reference at `/records/[id]` stays on References, and only when the caller
 * has already decided the record is a World document.
 */
export function matchWorldDestination(
  pathname: string,
  options: { recordIsWorld?: boolean } = {},
): WorldDestinationMatch | null {
  const parsed = parseProjectPath(pathname);
  if (!parsed) return null;
  const [first, second, third] = parsed.rest;
  if (first === "records" && second) {
    return options.recordIsWorld ? { key: "references", exact: false } : null;
  }
  if (first === "continuity") return { key: "continuity", exact: true };
  if (first !== "world") return null;
  if (!second) return { key: "references", exact: true };
  const destination = DESTINATIONS.find((item) => item.segment === second);
  if (!destination) return null;
  return { key: destination.key, exact: third === undefined };
}

export interface WorldCrumb {
  label: string;
  href?: string;
  current?: boolean;
}

/** World / surface, plus an optional deeper title (a map or board name). */
export function worldSurfaceCrumbs(projectId: string, key: WorldDestinationKey, currentLabel?: string): WorldCrumb[] {
  const destination = worldDestinationByKey(key);
  const world = { label: SHELL.world, href: worldDestinationHref(projectId, "references") };
  if (!currentLabel) return [world, { label: destination.label, current: true }];
  return [
    world,
    { label: destination.label, href: worldDestinationHref(projectId, key) },
    { label: currentLabel, current: true },
  ];
}
