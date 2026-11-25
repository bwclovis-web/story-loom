import { describe, expect, it } from "vitest";
import {
  parseReferenceTab,
  referenceTabFromHash,
  referenceTabHref,
  referenceTabVisibility,
  resolveReferenceTab,
  visibleReferenceTabs,
} from "@/world/referenceTabs";

describe("referenceTabVisibility", () => {
  it("shows Living World profile for worldbuilding and Established when linkable", () => {
    const v = referenceTabVisibility("worldbuilding");
    expect(v.profile).toBe("world");
    expect(v.established).toBe(true);
    expect(visibleReferenceTabs(v)).toEqual([
      "document",
      "profile",
      "images",
      "relationships",
      "established",
    ]);
  });

  it("shows character profile for dossiers", () => {
    const v = referenceTabVisibility("character_dossier");
    expect(v.profile).toBe("character");
    expect(visibleReferenceTabs(v)).toContain("profile");
  });

  it("omits profile when neither world nor dossier", () => {
    // manuscript types are not reference pages, but guard the helper
    const v = referenceTabVisibility("manuscript_chapter");
    expect(v.profile).toBe(false);
    expect(visibleReferenceTabs(v)).toEqual(["document", "images", "relationships"]);
  });

  it("hides Established when facts payload is absent", () => {
    const v = referenceTabVisibility("worldbuilding", { hasEstablishedFacts: false });
    expect(v.established).toBe(false);
    expect(visibleReferenceTabs(v)).not.toContain("established");
  });
});

describe("parse and resolve", () => {
  it("parses known tabs and rejects junk", () => {
    expect(parseReferenceTab("images")).toBe("images");
    expect(parseReferenceTab("IMAGES")).toBe("images");
    expect(parseReferenceTab("nope")).toBeNull();
    expect(parseReferenceTab(undefined)).toBeNull();
  });

  it("falls back to document for unsupported or missing tabs", () => {
    const noProfile = referenceTabVisibility("manuscript_note", { hasEstablishedFacts: false });
    expect(resolveReferenceTab(undefined, noProfile)).toBe("document");
    expect(resolveReferenceTab("profile", noProfile)).toBe("document");
    expect(resolveReferenceTab("established", noProfile)).toBe("document");
    expect(resolveReferenceTab("images", noProfile)).toBe("images");
  });
});

describe("referenceTabFromHash", () => {
  it("maps legacy hashes to tabs", () => {
    expect(referenceTabFromHash("#images")).toBe("images");
    expect(referenceTabFromHash("world-profile")).toBe("profile");
    expect(referenceTabFromHash("#character-development")).toBe("profile");
    expect(referenceTabFromHash("#place-relations")).toBe("relationships");
    expect(referenceTabFromHash("record-relations")).toBe("relationships");
    expect(referenceTabFromHash("#doc-terrain")).toBe("document");
    expect(referenceTabFromHash("#doc-terrain-2")).toBe("document");
    expect(referenceTabFromHash("#reference-editor")).toBe("document");
    expect(referenceTabFromHash("#history")).toBeNull();
  });
});

describe("referenceTabHref", () => {
  it("omits tab for document and preserves canvas", () => {
    const href = referenceTabHref("/projects/p1/records/r1", "document", {
      canvasPath: "/projects/p1/world/maps/m1",
    });
    expect(href).toContain("canvas=");
    expect(href).not.toContain("tab=");
  });

  it("sets tab and edit when requested", () => {
    const href = referenceTabHref("/projects/p1/records/r1", "images", { edit: true });
    expect(href).toContain("tab=images");
    expect(href).toContain("edit=1");
  });
});
