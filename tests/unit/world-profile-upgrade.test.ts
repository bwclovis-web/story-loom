import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyWorldProfile,
  readWorldProfile,
  setWorldFieldMeta,
  withWorldProfile,
  worldFieldMetaOf,
} from "@/domain/worldProfile";
import {
  analyzeWorldProfileUpgrade,
  applyWorldUpgradeDecisions,
  buildWorldUpgradeChangePackage,
  emptyWorldMarkdownArchive,
  fieldsAfterWorldUpgrade,
  readWorldMarkdownArchive,
  WORLD_MARKDOWN_ARCHIVE_KEY,
} from "@/domain/worldProfileUpgrade";
import { getBuiltinWorldProfileDefinition } from "@/world/worldProfileRegistry";

const FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "world-profile-upgrade.md"), "utf8");

describe("world profile Markdown upgrade", () => {
  const definition = getBuiltinWorldProfileDefinition("builtin:place");

  it("classifies headings with provenance and never auto-approves", () => {
    const analysis = analyzeWorldProfileUpgrade(FIXTURE, emptyWorldProfile(), {}, definition);
    expect(analysis.items.length).toBeGreaterThan(0);
    const overview = analysis.items.find((item) => /overview/i.test(item.sourceHeading));
    expect(overview?.proposedValue).toContain("sheltered harbor");
    expect(overview?.authorityHint).not.toBe("approved");

    const mystery = analysis.items.find((item) => /Open questions/i.test(item.sourceHeading));
    expect(mystery?.authorityHint).toBe("unresolved");
    expect(mystery?.requiresHumanReview).toBe(true);

    const history = analysis.items.find((item) => /History/i.test(item.sourceHeading));
    expect(history?.requiresHumanReview).toBe(true);
    // Place definition does not own a History field — the section is held unclassified.
    expect(history?.storage).toBe("hold");
    expect(/supersedes|formerly/i.test(history?.sourceText ?? "")).toBe(true);

    const proposed = analysis.items.find(
      (item) => /PROPOSED/i.test(item.sourceHeading) || item.authorityHint === "proposed",
    );
    expect(proposed?.authorityHint).toBe("proposed");

    expect(analysis.unclassifiedHeadings.some((heading) => /Unmapped/i.test(heading))).toBe(true);
  });

  it("flags conflicts when existing approved content differs", () => {
    let profile = emptyWorldProfile();
    profile = { ...profile, summary: "Old summary." };
    profile = setWorldFieldMeta(profile, "summary", {
      approval: "approved",
      provenance: { origin: "author", note: "Canon" },
    });
    const analysis = analyzeWorldProfileUpgrade(FIXTURE, profile, {}, definition);
    const summaryItem = analysis.items.find((item) => item.storage === "summary" || item.fieldPath === "summary");
    if (summaryItem) {
      expect(summaryItem.requiresHumanReview).toBe(true);
      expect(summaryItem.existingAuthority).toBe("approved");
    } else {
      const conflict = analysis.items.find((item) => item.reviewReasons.some((reason) => /approved|Conflicts/i.test(reason)));
      expect(conflict).toBeTruthy();
    }
  });

  it("applies accepts as extracted draft, archives Markdown, and supports reject/defer/modify", () => {
    const analysis = analyzeWorldProfileUpgrade(FIXTURE, emptyWorldProfile(), { kind: "place" }, definition);
    const geography = analysis.items.find((item) => /Geography/i.test(item.sourceHeading))!;
    const rules = analysis.items.find((item) => /Rules/i.test(item.sourceHeading))!;
    const trivia = analysis.items.find((item) => item.storage === "hold" || /Unmapped/i.test(item.sourceHeading))!;

    const applied = applyWorldUpgradeDecisions({
      body: FIXTURE,
      profile: emptyWorldProfile(),
      flatFields: { kind: "place" },
      definition,
      analysis,
      decisions: analysis.items.map((item) => {
        if (item.id === geography.id) return { itemId: item.id, decision: "accept" as const };
        if (item.id === rules.id) {
          return { itemId: item.id, decision: "modify" as const, modifiedValue: "Writ required for warships." };
        }
        if (item.id === trivia.id) return { itemId: item.id, decision: "defer" as const };
        return { itemId: item.id, decision: "reject" as const };
      }),
      archive: emptyWorldMarkdownArchive(),
      sourceRevision: 1,
    });

    expect(applied.appliedItemIds).toContain(geography.id);
    expect(applied.rejectedItemIds.length).toBeGreaterThan(0);
    expect(applied.deferredItemIds).toContain(trivia.id);
    expect(applied.archive.entries).toHaveLength(1);
    expect(applied.archive.entries[0]?.body).toBe(FIXTURE);

    const metaPath = geography.storage === "flat" ? `fields.${geography.fieldPath}` : `values.${geography.fieldPath}`;
    const meta =
      geography.storage === "summary"
        ? worldFieldMetaOf(applied.profile, "summary")
        : worldFieldMetaOf(applied.profile, metaPath);
    if (geography.storage !== "hold") {
      expect(meta.provenance.origin).toBe("extracted");
      expect(meta.approval).toBe("draft");
    }

    const fields = fieldsAfterWorldUpgrade({ kind: "place" }, applied);
    expect(fields[WORLD_MARKDOWN_ARCHIVE_KEY]).toBeTruthy();
    expect(readWorldMarkdownArchive(fields).entries).toHaveLength(1);
    expect(readWorldProfile(fields).ok).toBe(true);
  });

  it("builds an inspectable change package without auto-approval", () => {
    const fields = withWorldProfile({ kind: "place" }, { ...emptyWorldProfile(), summary: "Harbor" });
    const pkg = buildWorldUpgradeChangePackage({
      workspaceId: "wsp_test",
      projectId: "prj_test",
      recordId: "rec_test",
      expectedRevision: 1,
      packageId: "pkg_world_upgrade_test",
      fields,
    });
    expect(pkg.approval.status).toBe("proposed");
    expect(pkg.operations[0]?.op).toBe("update_record");
  });
});
