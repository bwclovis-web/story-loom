import { describe, expect, it } from "vitest";
import type { RecordNavEntry } from "@/ui/navigation";
import {
  applyWorldKindToFields,
  sanitizeWorldbuildingFields,
  WORLD_KIND_CUSTOM_UI,
  WORLDBUILDING_KIND_OTHER,
  worldbuildingCustomKind,
  worldbuildingKindFromFields,
  worldKindCounts,
  worldKindEditorMode,
} from "@/world/worldKinds";
import { filterWorldTitles, worldHref, WORLDBUILDING_KIND_UNSET } from "@/ui/world";

const entry = (
  id: string,
  title: string,
  worldKind: RecordNavEntry["worldKind"] = null,
  customKind: RecordNavEntry["customKind"] = null,
): RecordNavEntry => ({
  id,
  title,
  type: "worldbuilding",
  parentRecordId: null,
  position: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  worldKind,
  customKind,
});

describe("worldbuilding kinds", () => {
  it("reads and sanitizes kind in fields", () => {
    expect(worldbuildingKindFromFields({ kind: "place", climate: "Wet" })).toBe("place");
    expect(worldbuildingKindFromFields({ kind: "places" })).toBe(null);
    expect(worldbuildingCustomKind({ kind: "River pact" })).toBe("River pact");
    expect(sanitizeWorldbuildingFields({ kind: "magic_system", note: 1 })).toEqual({ kind: "magic_system", note: 1 });
    expect(sanitizeWorldbuildingFields({ kind: "  Festival  " })).toEqual({ kind: "Festival" });
    expect(sanitizeWorldbuildingFields({ kind: 123 })).toEqual({});
  });

  it("merges kind and typed fields without removing unrelated keys", () => {
    const next = applyWorldKindToFields({ aliases: ["X"] }, "place", { parentPlace: "Harbour", climate: "" });
    expect(next).toEqual({ aliases: ["X"], kind: "place", parentPlace: "Harbour" });
    expect(applyWorldKindToFields({ kind: "place" }, "River trade pact", {})).toEqual({ kind: "River trade pact" });
    expect(applyWorldKindToFields({ kind: "place" }, "River ", {})).toEqual({ kind: "River " });
    expect(applyWorldKindToFields({ kind: "place" }, WORLD_KIND_CUSTOM_UI, {})).toEqual({});
    expect(sanitizeWorldbuildingFields({ kind: "River " })).toEqual({ kind: "River" });
  });

  it("keeps Custom selected before a name is stored", () => {
    expect(worldKindEditorMode({}, false)).toEqual({ selectValue: "", customName: "" });
    expect(worldKindEditorMode({}, true)).toEqual({ selectValue: WORLD_KIND_CUSTOM_UI, customName: "" });
    expect(worldKindEditorMode({ kind: "River " }, false)).toEqual({
      selectValue: WORLD_KIND_CUSTOM_UI,
      customName: "River ",
    });
    expect(worldKindEditorMode({ kind: "River trade pact" }, false)).toEqual({
      selectValue: WORLD_KIND_CUSTOM_UI,
      customName: "River trade pact",
    });
    expect(worldKindEditorMode({ kind: "place" }, true).selectValue).toBe("place");
  });

  it("filters nav and builds links by kind", () => {
    const records = [
      entry("a", "Harbour", "place"),
      entry("b", "Guild", "organization"),
      entry("c", "Loose", null),
      entry("d", "Pact", null, "River pact"),
    ];
    expect(worldKindCounts(records)).toMatchObject({
      place: 1,
      organization: 1,
      [WORLDBUILDING_KIND_UNSET]: 1,
      [WORLDBUILDING_KIND_OTHER]: 1,
    });
    expect(filterWorldTitles(records, "", "worldbuilding", "place").map((r) => r.id)).toEqual(["a"]);
    expect(filterWorldTitles(records, "", "worldbuilding", WORLDBUILDING_KIND_UNSET).map((r) => r.id)).toEqual(["c"]);
    expect(filterWorldTitles(records, "", "worldbuilding", WORLDBUILDING_KIND_OTHER).map((r) => r.id)).toEqual(["d"]);
    expect(worldHref("prj", { type: "worldbuilding", kind: "place" })).toBe("/projects/prj/world?type=worldbuilding&kind=place");
  });
});