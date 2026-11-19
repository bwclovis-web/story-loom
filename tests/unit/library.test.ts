import { describe, expect, it } from "vitest";
import { DEMO_WORKSPACE_ID } from "@/domain/demoIdentity";
import { COVER_MOTIFS, coverMotifForProject, isExampleWorkspace, manuscriptEyebrow, pickFeaturedProject } from "@/ui/library";

describe("cover artwork", () => {
  it("picks a motif from the project id and ignores the title", () => {
    const first = coverMotifForProject("prj_alpha");
    expect(COVER_MOTIFS).toContain(first);
    expect(coverMotifForProject("prj_alpha")).toBe(first);
    const seen = new Set(Array.from({ length: 24 }, (_, i) => coverMotifForProject(`prj_${i}`)));
    expect(seen.size).toBe(COVER_MOTIFS.length);
  });
});

describe("example workspaces", () => {
  it("recognises only the seeded demo workspace id", () => {
    expect(isExampleWorkspace(DEMO_WORKSPACE_ID)).toBe(true);
    expect(isExampleWorkspace("wsp_demo")).toBe(true);
    expect(isExampleWorkspace("wsp_morrigan")).toBe(false);
    expect(isExampleWorkspace("wsp_the_salt_archive")).toBe(false);
    expect(isExampleWorkspace("wsp_demo_notes")).toBe(false);
  });
});

describe("featured manuscript", () => {
  const projects = [
    { id: "prj_demo", workspaceId: DEMO_WORKSPACE_ID, title: "The Salt Archive" },
    { id: "prj_own", workspaceId: "wsp_own", title: "Archive Demo Notes" },
    { id: "prj_next", workspaceId: "wsp_own", title: "Later book" },
  ];

  it("uses the project this browser last opened", () => {
    expect(pickFeaturedProject(projects, "prj_next")?.id).toBe("prj_next");
    expect(pickFeaturedProject(projects, "prj_demo")?.id).toBe("prj_demo");
  });

  it("ignores an unknown selection and prefers a non-example project", () => {
    expect(pickFeaturedProject(projects, "prj_missing")?.id).toBe("prj_own");
    expect(pickFeaturedProject(projects, null)?.id).toBe("prj_own");
  });

  it("falls back to the demo project when it is the only one", () => {
    expect(pickFeaturedProject([projects[0]], null)?.id).toBe("prj_demo");
  });

  it("returns null when there are no projects", () => {
    expect(pickFeaturedProject([], "prj_own")).toBeNull();
  });

  it("uses the series name for the eyebrow and otherwise the workspace name", () => {
    expect(manuscriptEyebrow("Northwater Cycle", "Workspace")).toBe("Northwater Cycle");
    expect(manuscriptEyebrow(null, "Demo workspace")).toBe("Demo workspace");
    expect(manuscriptEyebrow("  ", "Demo workspace")).toBe("Demo workspace");
  });
});
