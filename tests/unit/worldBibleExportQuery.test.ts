import { describe, expect, it } from "vitest";
import {
  parseWorldBibleExportQuery,
  worldBibleSelectionHasScope,
} from "@/server/services/worldBibleExportQuery";

describe("worldBibleExportQuery", () => {
  it("parses full mode defaults and collection scope", () => {
    const params = new URLSearchParams("collection=scol_1&record=a");
    const { selection, policy } = parseWorldBibleExportQuery(params);
    expect(selection.collectionId).toBe("scol_1");
    expect(selection.recordIds).toEqual(["a"]);
    expect(policy.mode).toBe("full");
    expect(policy.approvedOnly).toBe(false);
    expect(worldBibleSelectionHasScope(selection)).toBe(true);
  });

  it("treats spoilerBefore as point mode with approved default", () => {
    const params = new URLSearchParams("mode=point&spoilerBefore=ch1&book=prj2&ceiling=approved&category=locations");
    const { selection, policy } = parseWorldBibleExportQuery(params);
    expect(policy.mode).toBe("point");
    expect(policy.storyPointRecordId).toBe("ch1");
    expect(policy.bookProjectId).toBe("prj2");
    expect(policy.approvedOnly).toBe(true);
    expect(selection.category).toBe("locations");
  });
});
