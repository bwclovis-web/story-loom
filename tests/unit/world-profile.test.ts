import { describe, expect, it } from "vitest";
import {
  emptyWorldProfile,
  formatWorldProfileFieldValue,
  isWorldProfileRecordType,
  readWorldProfile,
  unsupportedWorldProfileVersion,
  withWorldProfile,
  withoutWorldProfile,
  worldFieldMetaOf,
  worldProfileIsEmpty,
  worldProfileOnUnsupportedTypeProblems,
  worldProfileWriteProblems,
  WORLD_PROFILE_KEY,
  type WorldProfile,
} from "@/domain/worldProfile";
import {
  getBuiltinWorldProfileDefinition,
  listAvailableWorldProfileDefinitions,
  listBuiltinWorldProfileDefinitions,
  validateProfileValuesAgainstDefinition,
} from "@/world/worldProfileRegistry";

describe("world profile overlay", () => {
  it("reads empty when worldProfile is absent and preserves unknown keys on write", () => {
    const read = readWorldProfile({ climate: "temperate" });
    expect(read.ok).toBe(true);
    expect(read.profile).toEqual(emptyWorldProfile());
    expect(worldProfileIsEmpty(read.profile)).toBe(true);

    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      summary: "A quiet harbor",
      values: { tradeGoods: "salt" },
      fieldMeta: {
        summary: { approval: "draft", provenance: { origin: "author", note: "" } },
      },
    };
    const stored = withWorldProfile({ climate: "temperate", worldProfile: { version: 1, customNote: "keep me" } }, profile);
    expect(stored.climate).toBe("temperate");
    const overlay = stored[WORLD_PROFILE_KEY] as Record<string, unknown>;
    expect(overlay.customNote).toBe("keep me");
    expect(overlay.summary).toBe("A quiet harbor");
    expect(withoutWorldProfile(stored).climate).toBe("temperate");
    expect(withoutWorldProfile(stored)[WORLD_PROFILE_KEY]).toBeUndefined();
  });

  it("defaults missing fieldMeta to draft/author and never auto-approves", () => {
    const read = readWorldProfile({
      worldProfile: {
        version: 1,
        values: { climateNote: "wet winters" },
      },
    });
    expect(read.ok).toBe(true);
    const meta = worldFieldMetaOf(read.profile, "values.climateNote");
    expect(meta.approval).toBe("draft");
    expect(meta.provenance.origin).toBe("author");
  });

  it("rejects unsupported versions without inventing a profile", () => {
    const raw = { version: 99, summary: "future" };
    expect(unsupportedWorldProfileVersion({ worldProfile: raw })).toBe(true);
    const read = readWorldProfile({ worldProfile: raw });
    expect(read.ok).toBe(false);
    expect(worldProfileIsEmpty(read.profile)).toBe(true);
    expect(worldProfileWriteProblems(raw).some((p) => p.path.includes("version"))).toBe(true);
  });

  it("allows worldProfile only on non-character World types", () => {
    const fields = withWorldProfile({}, { ...emptyWorldProfile(), summary: "x" });
    expect(isWorldProfileRecordType("worldbuilding")).toBe(true);
    expect(isWorldProfileRecordType("character_dossier")).toBe(false);
    expect(worldProfileOnUnsupportedTypeProblems("character_dossier", fields).length).toBeGreaterThan(0);
    expect(worldProfileOnUnsupportedTypeProblems("worldbuilding", fields)).toEqual([]);
    expect(worldProfileOnUnsupportedTypeProblems("manuscript_chapter", fields).length).toBeGreaterThan(0);
  });

  it("formats typed values including calendar dates and record refs", () => {
    expect(formatWorldProfileFieldValue("plain")).toBe("plain");
    expect(formatWorldProfileFieldValue({ recordId: "rec_abc" })).toBe("rec_abc");
    expect(formatWorldProfileFieldValue({ year: 412, monthPosition: 3, day: 12, freeText: "Midwinter" })).toContain(
      "Midwinter",
    );
  });

  it("keeps built-in kind flat fields as storage:flat so values do not duplicate them", () => {
    const definition = getBuiltinWorldProfileDefinition("builtin:place");
    expect(definition).toBeTruthy();
    const flatKeys = (definition?.fields ?? []).filter((field) => field.storage === "flat").map((field) => field.key);
    expect(flatKeys.length).toBeGreaterThan(0);
    expect(flatKeys).toContain("climate");
    const problems = validateProfileValuesAgainstDefinition(definition!, emptyWorldProfile(), { climate: "temperate" });
    expect(problems).toEqual([]);
  });

  it("lists built-in definitions and merges custom templates without dropping builtins of other kinds", () => {
    const builtins = listBuiltinWorldProfileDefinitions();
    expect(builtins.some((d) => d.id === "builtin:place")).toBe(true);
    const available = listAvailableWorldProfileDefinitions([
      {
        id: "wkt_1",
        projectId: "prj_1",
        kind: "harbor_league",
        fields: [{ key: "dockFees", label: "Dock fees", multiline: false }],
        worldScope: null,
        home: null,
        definitionId: "custom:harbor_league",
        label: "Harbor league",
        description: "",
        categorySlug: "economy",
        subcategorySlug: null,
        profileSpecJson: JSON.stringify({
          version: 1,
          fields: [{ key: "charterYear", label: "Charter year", type: "number", storage: "profile" }],
          collections: [],
        }),
      },
    ]);
    expect(available.some((d) => d.id === "custom:harbor_league")).toBe(true);
    expect(available.some((d) => d.id === "builtin:place")).toBe(true);
  });
});
