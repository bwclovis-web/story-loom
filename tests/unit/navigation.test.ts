import { describe, expect, it } from "vitest";
import { RECORD_TYPES, type RecordType } from "@/domain/recordTypes";
import { activeGlobalItem, groupOfType, parseProjectPath, RECORD_GROUP_IDS, RECORD_GROUPS } from "@/ui/navigation";

const types = new Map<string, RecordType>([
  ["rec_ch1", "manuscript_chapter"],
  ["rec_outline", "chapter_outline"],
  ["rec_dossier", "character_dossier"],
]);
const typeOf = (id: string) => types.get(id);

describe("record groups", () => {
  it("place every record type in exactly one of Write, Plan and World", () => {
    for (const type of RECORD_TYPES) {
      const groups = RECORD_GROUP_IDS.filter((g) => (RECORD_GROUPS[g] as readonly RecordType[]).includes(type));
      expect(groups, type).toHaveLength(1);
      expect(groupOfType(type)).toBe(groups[0]);
    }
  });

  it("keep the manuscript and its notes under Write only", () => {
    expect(RECORD_GROUPS.write).toEqual(["manuscript_chapter", "manuscript_scene", "scene_note"]);
    for (const group of ["plan", "world"] as const) {
      const types: readonly RecordType[] = RECORD_GROUPS[group];
      expect(types.some((t) => t.startsWith("manuscript") || t === "scene_note")).toBe(false);
    }
  });
});

describe("parseProjectPath", () => {
  it("reads the project ID and the rest of the path", () => {
    expect(parseProjectPath("/projects/prj_a")).toEqual({ projectId: "prj_a", rest: [] });
    expect(parseProjectPath("/projects/prj_a/records/rec_1")).toEqual({ projectId: "prj_a", rest: ["records", "rec_1"] });
    expect(parseProjectPath("/backup")).toBeNull();
    expect(parseProjectPath("/projectsx/prj_a")).toBeNull();
  });
});

describe("activeGlobalItem", () => {
  it("maps routes to the global navigation", () => {
    expect(activeGlobalItem("/", typeOf)).toBeNull();
    expect(activeGlobalItem("/backup", typeOf)).toBe("backups");
    expect(activeGlobalItem("/connections", typeOf)).toBe("connections");
    expect(activeGlobalItem("/trash", typeOf)).toBe("trash");
    expect(activeGlobalItem("/help", typeOf)).toBe("help");
    expect(activeGlobalItem("/projects/p", typeOf)).toBeNull();
    expect(activeGlobalItem("/projects/p/write", typeOf)).toBe("write");
    expect(activeGlobalItem("/projects/p/plan", typeOf)).toBe("plan");
    expect(activeGlobalItem("/projects/p/world", typeOf)).toBe("world");
    expect(activeGlobalItem("/projects/p/assistant", typeOf)).toBe("assistant");
    expect(activeGlobalItem("/projects/p/read", typeOf)).toBe("write");
    expect(activeGlobalItem("/projects/p/import-chapters", typeOf)).toBe("write");
    expect(activeGlobalItem("/projects/p/history", typeOf)).toBeNull();
    expect(activeGlobalItem("/projects/p/dictionary", typeOf)).toBeNull();
  });

  it("places a record page by the record's type", () => {
    expect(activeGlobalItem("/projects/p/records/rec_ch1", typeOf)).toBe("write");
    expect(activeGlobalItem("/projects/p/records/rec_outline", typeOf)).toBe("plan");
    expect(activeGlobalItem("/projects/p/records/rec_dossier", typeOf)).toBe("world");
    expect(activeGlobalItem("/projects/p/records/rec_unknown", typeOf)).toBeNull();
  });
});
