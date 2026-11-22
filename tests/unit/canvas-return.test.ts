import { describe, expect, it } from "vitest";
import {
  canvasReturnPath,
  parseCanvasReturn,
  selectionStillPresent,
  withCanvasReturn,
} from "@/world/canvasReturn";
import { readBoardFilter, readBoardView } from "@/world/boardViewState";

const projectId = "prj_demo";

describe("canvas return", () => {
  it("builds a project-scoped map or board path and round-trips it", () => {
    const mapPath = canvasReturnPath(projectId, "maps", "wmp_1", "wpin_1");
    const boardPath = canvasReturnPath(projectId, "boards", "brd_1", "bcd_1");
    expect(parseCanvasReturn(projectId, mapPath)).toMatchObject({
      surface: "maps",
      surfaceId: "wmp_1",
      itemId: "wpin_1",
    });
    expect(parseCanvasReturn(projectId, boardPath)?.href).toBe(boardPath);
    expect(withCanvasReturn(`/projects/${projectId}/records/rec_1`, mapPath, true)).toBe(
      `/projects/${projectId}/records/rec_1?edit=1&canvas=${encodeURIComponent(mapPath)}`,
    );
  });

  it("rejects another project, an open redirect, and extra query keys", () => {
    expect(parseCanvasReturn(projectId, "/projects/prj_other/world/maps/wmp_1")).toBeNull();
    expect(parseCanvasReturn(projectId, "https://example.com/projects/prj_demo/world/maps/wmp_1")).toBeNull();
    expect(parseCanvasReturn(projectId, "//example.com/projects/prj_demo/world/maps/wmp_1")).toBeNull();
    expect(parseCanvasReturn(projectId, "/projects/prj_demo/world/maps/wmp_1?pin=wpin_1&next=/admin")).toBeNull();
    expect(parseCanvasReturn(projectId, "/projects/prj_demo/records/rec_1")).toBeNull();
    expect(selectionStillPresent(["wpin_1"], "wpin_1")).toBe(true);
    expect(selectionStillPresent(["wpin_1"], "wpin_gone")).toBe(false);
  });

  it("keeps an unknown stored board filter and view on the safe defaults", () => {
    expect(readBoardFilter("brd_missing")).toBe("all");
    expect(readBoardView("brd_missing")).toBe("canvas");
  });
});
