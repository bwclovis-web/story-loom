import { describe, expect, it } from "vitest";
import {
  matchWorldDestination,
  worldDestinationHref,
  WORLD_DESTINATION_GROUPS,
  WORLD_DESTINATIONS,
  worldSurfaceCrumbs,
} from "@/ui/worldDestinations";

describe("world destination registry", () => {
  it("lists each surface once, in the four groups", () => {
    const keys = WORLD_DESTINATION_GROUPS.flatMap((group) => group.keys);
    expect(keys).toEqual(["references", "relationships", "development", "maps", "boards", "continuity", "events", "calendar", "names"]);
    expect(new Set(keys).size).toBe(WORLD_DESTINATIONS.length);
    expect(WORLD_DESTINATION_GROUPS.map((group) => group.heading)).toEqual([
      "Lore & Codex",
      "Visual spaces",
      "Time & continuity",
      "Tools",
    ]);
  });

  it("keeps the existing routes", () => {
    expect(worldDestinationHref("prj", "references")).toBe("/projects/prj/world");
    expect(worldDestinationHref("a/b", "maps")).toBe("/projects/a%2Fb/world/maps");
    expect(worldDestinationHref("prj", "boards")).toBe("/projects/prj/world/boards");
    expect(worldDestinationHref("prj", "events")).toBe("/projects/prj/world/events");
    expect(worldDestinationHref("prj", "calendar")).toBe("/projects/prj/world/calendar");
    expect(worldDestinationHref("prj", "relationships")).toBe("/projects/prj/world/relationships");
    expect(worldDestinationHref("prj", "development")).toBe("/projects/prj/world/development");
    expect(worldDestinationHref("prj", "names")).toBe("/projects/prj/world/names");
    expect(worldDestinationHref("prj", "continuity")).toBe("/projects/prj/continuity");
    expect(matchWorldDestination("/projects/prj/continuity")).toEqual({ key: "continuity", exact: true });
  });

  it("marks the hub and a nested map differently, and ignores the query string", () => {
    expect(matchWorldDestination("/projects/prj/world")).toEqual({ key: "references", exact: true });
    expect(matchWorldDestination("/projects/prj/world/maps")).toEqual({ key: "maps", exact: true });
    expect(matchWorldDestination("/projects/prj/world/maps/map_1")).toEqual({ key: "maps", exact: false });
    expect(matchWorldDestination("/projects/prj/world/boards/board_1")).toEqual({ key: "boards", exact: false });
    expect(matchWorldDestination("/projects/prj/world/events")).toEqual({ key: "events", exact: true });
    expect(matchWorldDestination("/projects/prj/world/nope")).toBeNull();
  });

  it("keeps a world reference record on References and leaves other records alone", () => {
    expect(matchWorldDestination("/projects/prj/records/rec_1", { recordIsWorld: true })).toEqual({
      key: "references",
      exact: false,
    });
    expect(matchWorldDestination("/projects/prj/records/rec_1", { recordIsWorld: false })).toBeNull();
    expect(matchWorldDestination("/projects/prj/write")).toBeNull();
  });

  it("builds a reusable trail for a surface and a deeper title", () => {
    expect(worldSurfaceCrumbs("prj", "calendar")).toEqual([
      { label: "World", href: "/projects/prj/world" },
      { label: "World calendar", current: true },
    ]);
    expect(worldSurfaceCrumbs("prj", "maps", "Greyhaven")).toEqual([
      { label: "World", href: "/projects/prj/world" },
      { label: "Maps", href: "/projects/prj/world/maps" },
      { label: "Greyhaven", current: true },
    ]);
  });
});
