import { describe, expect, it } from "vitest";
import { excerptAt, searchQuerySqlForms } from "@/server/services/searchService";

describe("search Unicode normalisation", () => {
  it("includes both NFC and NFD forms when they differ", () => {
    expect(searchQuerySqlForms("café")).toEqual(["café", "cafe\u0301"]);
    expect(searchQuerySqlForms("salt")).toEqual(["salt"]);
  });

  it("matches an NFD body against an NFC query and returns an NFC excerpt", () => {
    const body = "The cafe\u0301 kept a blue lantern.";
    const hit = excerptAt(body, "café");
    expect(hit).not.toBeNull();
    expect(hit!.excerpt).toContain("café");
    expect(hit!.excerpt).not.toContain("\u0301");
  });
});
