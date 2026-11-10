import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_ROUTES, HELP_SCRIPTS, HELP_SECTIONS } from "@/help/outline";

const root = path.resolve(__dirname, "../..");
const helpSource = readFileSync(path.join(root, "src/help/HelpContent.tsx"), "utf8");

describe("How to use help", () => {
  it("has unique section anchors", () => {
    const ids = HELP_SECTIONS.flatMap((s) => [s.id, ...("children" in s ? s.children.map((c) => c.id) : [])]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only cites pnpm scripts that exist", () => {
    const scripts = Object.keys(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts);
    for (const script of HELP_SCRIPTS) expect(scripts).toContain(script);

    const cited = [...helpSource.matchAll(/script="([^"]+)"/g)].map((m) => m[1]);
    expect(cited.length).toBeGreaterThan(0);
    for (const script of cited) expect(HELP_SCRIPTS).toContain(script);
  });

  it("only describes routes that exist", () => {
    const appDir = path.join(root, "src/app");
    // Route groups such as (site) do not appear in the URL.
    const groups = readdirSync(appDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\(.+\)$/.test(d.name))
      .map((d) => d.name);
    for (const route of HELP_ROUTES) {
      const segments = route.split("/").filter(Boolean);
      const dirs = [appDir, ...groups.map((g) => path.join(appDir, g))].map((base) => path.join(base, ...segments));
      const exists = dirs.some((dir) => ["page.tsx", "route.ts"].some((f) => existsSync(path.join(dir, f))));
      expect(exists, `${route} has no page.tsx or route.ts`).toBe(true);
    }
  });

  it("keeps destructive database commands out of the help", () => {
    expect(helpSource).not.toMatch(/db:reset|migrate reset/);
  });
});
