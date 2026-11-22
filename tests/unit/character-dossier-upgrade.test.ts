import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeDossierUpgrade,
  analyzeImportedMarkdown,
  applyUpgradeDecisions,
  buildUpgradeChangePackage,
  emptyDossierMarkdownArchive,
  fieldsAfterUpgrade,
  parseMarkdownSections,
  readDossierMarkdownArchive,
} from "@/domain/characterDossierUpgrade";
import {
  characterProfileMarkdown,
  emptyCharacterDevelopment,
  readCharacterDevelopment,
  withCharacterDevelopment,
} from "@/domain/characterDevelopment";

const FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "character-dossier-upgrade.md"), "utf8");

describe("character dossier upgrade analysis", () => {
  it("classifies headings with provenance and never invents lived experience as approved", () => {
    const analysis = analyzeDossierUpgrade(FIXTURE, emptyCharacterDevelopment());
    const byPath = Object.fromEntries(analysis.items.map((item) => [item.fieldPath, item]));

    expect(byPath["foundation.appearance"]?.proposedValue).toContain("Salt-grey cloak");
    expect(byPath["voice.diction"]?.sourceHeading).toBe("Voice");
    expect(byPath["psychology.coreDesire"]?.classificationConfidence).toBe("high");

    const trauma = analysis.items.find((item) => item.fieldPath === "livedExperience.trauma");
    expect(trauma?.destination).toBe("lived");
    expect(trauma?.requiresHumanReview).toBe(true);
    expect(trauma?.authorityHint).not.toBe("approved");

    const mystery = analysis.items.find((item) => item.destination === "protected_unknowns");
    expect(mystery?.requiresHumanReview).toBe(true);
    expect(mystery?.authorityHint).toBe("unresolved");

    const proposedFear = analysis.items.find((item) => item.sourceHeading.includes("PROPOSED"));
    expect(proposedFear?.authorityHint).toBe("proposed");

    const development = analysis.items.find((item) => item.destination === "development");
    expect(development?.reviewReasons.some((reason) => /planned growth/i.test(reason))).toBe(true);

    expect(analysis.unclassifiedHeadings.some((heading) => /Unmapped/i.test(heading))).toBe(true);
  });

  it("detects amendment supersession language for human review", () => {
    const analysis = analyzeDossierUpgrade(FIXTURE, emptyCharacterDevelopment());
    const amendment = analysis.items.find((item) => item.destination === "historical_amendments");
    expect(amendment).toBeTruthy();
    expect(amendment?.requiresHumanReview).toBe(true);
    expect(amendment?.reviewReasons.some((reason) => /amendment/i.test(reason))).toBe(true);
  });

  it("flags conflicts when existing canonical content differs", () => {
    const profile = emptyCharacterDevelopment();
    profile.foundation.appearance = "Black coat.";
    const analysis = analyzeDossierUpgrade(FIXTURE, profile);
    const appearance = analysis.items.find((item) => item.fieldPath === "foundation.appearance");
    expect(appearance?.existingCanonical).toBe("Black coat.");
    expect(appearance?.requiresHumanReview).toBe(true);
    expect(appearance?.reviewReasons.some((reason) => /differs/i.test(reason))).toBe(true);
  });

  it("applies accepts into draft fields and holds mysteries without resolving them", () => {
    const analysis = analyzeDossierUpgrade(FIXTURE, emptyCharacterDevelopment());
    const appearance = analysis.items.find((item) => item.fieldPath === "foundation.appearance")!;
    const mystery = analysis.items.find((item) => item.destination === "protected_unknowns")!;
    const trauma = analysis.items.find((item) => item.fieldPath === "livedExperience.trauma")!;
    const arc = analysis.items.find((item) => item.destination === "development")!;

    const applied = applyUpgradeDecisions(
      emptyCharacterDevelopment(),
      analysis,
      [
        { itemId: appearance.id, decision: "accept" },
        { itemId: mystery.id, decision: "accept" },
        { itemId: trauma.id, decision: "accept" },
        { itemId: arc.id, decision: "accept" },
        ...analysis.items
          .filter((item) => ![appearance.id, mystery.id, trauma.id, arc.id].includes(item.id))
          .map((item) => ({ itemId: item.id, decision: "defer" as const })),
      ],
      emptyDossierMarkdownArchive(),
      { body: FIXTURE, sourceRevision: 1 },
    );

    expect(applied.profile.foundation.appearance).toContain("Salt-grey cloak");
    expect(applied.profile.livedExperience.trauma).toContain("Do not invent");
    expect(applied.profile.livedExperience.approval).toBe("draft");
    expect(applied.profile.livedExperience.aiVisibility).toBe("omit");
    expect(applied.profile.arcs).toEqual([]);
    expect(applied.profile.migrationHold.some((item) => item.kind === "protected_unknowns")).toBe(true);
    expect(applied.profile.migrationHold.some((item) => item.kind === "proposed_unapproved")).toBe(true);
    expect(applied.archive.entries).toHaveLength(1);
    expect(applied.archive.entries[0]?.body).toBe(FIXTURE);
  });

  it("keeps rejected and deferred items out of structured fields", () => {
    const analysis = analyzeDossierUpgrade("## Appearance\nCloak.\n\n## Voice\nQuiet.\n", emptyCharacterDevelopment());
    const [appearance, voice] = analysis.items;
    const applied = applyUpgradeDecisions(
      emptyCharacterDevelopment(),
      analysis,
      [
        { itemId: appearance!.id, decision: "reject" },
        { itemId: voice!.id, decision: "defer" },
      ],
      emptyDossierMarkdownArchive(),
      { body: "## Appearance\nCloak.\n\n## Voice\nQuiet.\n", sourceRevision: 1 },
    );
    expect(applied.profile.foundation.appearance).toBe("");
    expect(applied.profile.voice.diction).toBe("");
    expect(applied.rejectedItemIds).toContain(appearance!.id);
    expect(applied.deferredItemIds).toContain(voice!.id);
  });

  it("round-trips profile export markdown after upgrade fields are stored", () => {
    const analysis = analyzeImportedMarkdown(FIXTURE);
    const appearance = analysis.items.find((item) => item.fieldPath === "foundation.appearance")!;
    const applied = applyUpgradeDecisions(
      emptyCharacterDevelopment(),
      analysis,
      [{ itemId: appearance.id, decision: "modify", modifiedValue: "Salt-grey cloak (edited)." }],
      emptyDossierMarkdownArchive(),
      { body: FIXTURE, sourceRevision: 2 },
    );
    const fields = fieldsAfterUpgrade({}, applied.profile, applied.archive);
    const read = readCharacterDevelopment(fields);
    expect(read.profile.foundation.appearance).toBe("Salt-grey cloak (edited).");
    const markdown = characterProfileMarkdown("Mara Venn", read.profile, "full");
    expect(markdown).toContain("Salt-grey cloak (edited).");
    const archive = readDossierMarkdownArchive(fields);
    expect(archive.entries[0]?.body).toContain("## Appearance");
    const again = withCharacterDevelopment(fields, read.profile);
    expect(readDossierMarkdownArchive(again).entries).toHaveLength(1);
  });

  it("builds a proposed change package that only updates profile fields", () => {
    const analysis = analyzeDossierUpgrade("## Skills\nLocks.\n", emptyCharacterDevelopment());
    const item = analysis.items[0]!;
    const applied = applyUpgradeDecisions(
      emptyCharacterDevelopment(),
      analysis,
      [{ itemId: item.id, decision: "accept" }],
      emptyDossierMarkdownArchive(),
      { body: "## Skills\nLocks.\n", sourceRevision: 1 },
    );
    const fields = fieldsAfterUpgrade({ name: "Mara" }, applied.profile, applied.archive);
    const pkg = buildUpgradeChangePackage({
      workspaceId: "wsp_test",
      projectId: "prj_test",
      recordId: "rec_test_mara_dossier",
      expectedRevision: 1,
      title: "Mara Venn",
      fields,
    });
    expect(pkg.approval.status).toBe("proposed");
    expect(pkg.scope).toBe("reference");
    expect(pkg.operations).toHaveLength(1);
    const op = pkg.operations[0]!;
    expect(op.op).toBe("update_record");
    if (op.op === "update_record") {
      expect(op.changes.body).toBeUndefined();
      expect(op.changes.fields?.set?.characterDevelopment).toBeTruthy();
      expect(op.changes.fields?.set?.dossierMarkdownArchive).toBeTruthy();
    }
  });

  it("parses preamble and tagged headings without dropping text", () => {
    const sections = parseMarkdownSections("Intro line.\n\n## Role — SELECTED\nArchivist.\n");
    expect(sections[0]?.heading).toBe("(preamble)");
    expect(sections[0]?.body).toContain("Intro line");
    expect(sections[1]?.tags).toContain("SELECTED");
    expect(sections[1]?.cleanHeading).toBe("Role");
  });
});
