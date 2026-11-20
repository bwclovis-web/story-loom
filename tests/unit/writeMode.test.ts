import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, parseLayoutPreference } from "@/components/shell/preferences";
import { spellingFooterKind } from "@/writing/spellingStatus";
import { parseWriteMode } from "@/writing/writeMode";

describe("parseWriteMode", () => {
  it("keeps the three layouts and falls back to desk", () => {
    expect(parseWriteMode("desk")).toBe("desk");
    expect(parseWriteMode("focus")).toBe("focus");
    expect(parseWriteMode("companion")).toBe("companion");
    expect(parseWriteMode("mode-02")).toBe("desk");
    expect(parseWriteMode(undefined)).toBe("desk");
  });
});

describe("parseLayoutPreference writeMode", () => {
  it("reads a saved layout and ignores an unknown one", () => {
    expect(parseLayoutPreference(JSON.stringify({ writeMode: "companion" })).writeMode).toBe("companion");
    expect(parseLayoutPreference(JSON.stringify({ secondaryHidden: true })).writeMode).toBe(DEFAULT_LAYOUT.writeMode);
    expect(parseLayoutPreference(undefined).writeMode).toBe("desk");
  });
});

describe("spellingFooterKind", () => {
  it("says clear only after the app checker finishes with no issues", () => {
    expect(
      spellingFooterKind({ checker: "app", status: "ready", issueCount: 0, checkCompleted: true }),
    ).toBe("clear");
  });

  it("does not treat an unfinished or empty check as clear", () => {
    expect(
      spellingFooterKind({ checker: "app", status: "loading", issueCount: 0, checkCompleted: false }),
    ).toBe("checking");
    expect(
      spellingFooterKind({ checker: "app", status: "ready", issueCount: 0, checkCompleted: false }),
    ).toBe("checking");
    expect(
      spellingFooterKind({ checker: "app", status: "ready", issueCount: 2, checkCompleted: true }),
    ).toBe("issues");
  });

  it("separates off, browser, and failed checks", () => {
    expect(
      spellingFooterKind({ checker: "app", status: "off", issueCount: 0, checkCompleted: false }),
    ).toBe("disabled");
    expect(
      spellingFooterKind({ checker: "browser", status: "off", issueCount: 0, checkCompleted: false }),
    ).toBe("unavailable");
    expect(
      spellingFooterKind({ checker: "browser", status: "ready", issueCount: 0, checkCompleted: true }),
    ).toBe("unavailable");
    expect(
      spellingFooterKind({ checker: "app", status: "error", issueCount: 0, checkCompleted: false }),
    ).toBe("failed");
  });
});
