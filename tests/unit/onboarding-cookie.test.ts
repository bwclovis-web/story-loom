import { describe, expect, it } from "vitest";
import { parseWalkthroughCookie, walkthroughCookieValue } from "@/components/shell/preferences";

describe("guided task cookie", () => {
  it("shows the new tour once after an earlier dismissal", () => {
    expect(parseWalkthroughCookie(undefined)).toEqual({ kind: "open", step: 0 });
    expect(parseWalkthroughCookie("dismissed")).toEqual({ kind: "open", step: 0 });
    expect(parseWalkthroughCookie("storyloom-simple-2026-11")).toEqual({ kind: "open", step: 0 });
    const current = walkthroughCookieValue({ kind: "dismissed" });
    expect(parseWalkthroughCookie(current)).toEqual({ kind: "dismissed" });
    expect(parseWalkthroughCookie("open:3")).toEqual({ kind: "open", step: 3 });
    expect(parseWalkthroughCookie("paused:2")).toEqual({ kind: "paused", step: 2 });
  });
});
