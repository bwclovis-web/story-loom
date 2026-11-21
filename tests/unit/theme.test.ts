import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nextTheme, parseTheme } from "@/ui/theme";

describe("colour theme", () => {
  it("reads a saved theme and falls back to light", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("purple")).toBe("light");
    expect(parseTheme(undefined)).toBe("light");
  });

  it("cycles light, dark, match system", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
    expect(nextTheme("system")).toBe("light");
  });

  it("keeps colours in tokens so both themes cover every rule", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const rules = css.slice(css.indexOf("* { box-sizing"));
    const hex = [...rules.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    // White title on the project switcher, which sits on the dark navigation column in both themes.
    expect(hex).toEqual(["#fff"]);
  });
});
