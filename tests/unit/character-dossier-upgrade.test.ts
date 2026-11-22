import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeDossierUpgrade,
  analyzeImportedMarkdown,
  applyUpgradeDecisions,
  buildUpgradeChangePackage,
  dismissHold,
  emptyDossierMarkdownArchive,
  fieldsAfterUpgrade,
  parseMarkdownSections,
  readDossierMarkdownArchive,
  readDossierMarkdownArchiveWithStatus,
  resolveHoldIntoField,
  updateHoldDecision,
  upgradeDecisionFingerprint,
} from "@/domain/characterDossierUpgrade";
import { CHARACTER_HEADING_MAP, findHeadingMapping } from "@/domain/characterHeadingExtraction";
import {
  characterProfileMarkdown,
  emptyCharacterDevelopment,
  fieldMetaOf,
  proposeProfileFillFromBody,
  readCharacterDevelopment,
  renderCharacterContextSlice,
  setFieldMeta,
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

  it("shares heading extraction with proposeProfileFillFromBody", () => {
    const body = "## Appearance\nSalt-grey cloak.\n\n## Voice\nClipped.\n\n## Desire\nTruth.\n";
    const analysis = analyzeDossierUpgrade(body, emptyCharacterDevelopment());
    const fills = proposeProfileFillFromBody(body, emptyCharacterDevelopment());
    expect(findHeadingMapping("Appearance")?.fieldPath).toBe("foundation.appearance");
    expect(CHARACTER_HEADING_MAP.some((row) => row.heading === "Voice")).toBe(true);
    expect(analysis.items.find((item) => item.fieldPath === "foundation.appearance")?.proposedValue).toContain(
      "Salt-grey cloak",
    );
    expect(fills.map((row) => row.key).sort()).toEqual(["appearance", "coreDesire", "diction"].sort());
  });

  it("stamps imported draft provenance and never auto-approves Markdown [APPROVED]", () => {
    const body = "## Appearance [APPROVED]\nSalt-grey cloak.\n";
    const analysis = analyzeDossierUpgrade(body, emptyCharacterDevelopment());
    const item = analysis.items[0]!;
    expect(item.authorityHint).toBe("approved");
    expect(item.requiresHumanReview).toBe(true);
    const applied = applyUpgradeDecisions(
      emptyCharacterDevelopment(),
      analysis,
      [{ itemId: item.id, decision: "accept" }],
      emptyDossierMarkdownArchive(),
      { body, sourceRevision: 1 },
    );
    const meta = fieldMetaOf(applied.profile, "foundation.appearance");
    expect(meta.approval).toBe("draft");
    expect(meta.provenance.origin).toBe("imported");
    expect(meta.provenance.sourceHeading).toContain("Appearance");
  });

  it("detects psychology/voice/behavior conflicts and supports keep/merge/replace", () => {
    const profile = emptyCharacterDevelopment();
    profile.psychology.coreDesire = "Safety.";
    profile.voice.diction = "Soft.";
    profile.behavior.habits = "Paces.";
    const body =
      "## Desire\nTruth at any cost.\n\n## Voice\nClipped answers.\n\n## Habits\nChecks locks twice.\n";
    const analysis = analyzeDossierUpgrade(body, profile);
    const desire = analysis.items.find((item) => item.fieldPath === "psychology.coreDesire")!;
    const voice = analysis.items.find((item) => item.fieldPath === "voice.diction")!;
    const habits = analysis.items.find((item) => item.fieldPath === "behavior.habits")!;
    expect(desire.existingCanonical).toBe("Safety.");
    expect(voice.requiresHumanReview).toBe(true);
    expect(habits.mergeSupported).toBe(true);

    const applied = applyUpgradeDecisions(
      profile,
      analysis,
      [
        { itemId: desire.id, decision: "keep_existing" },
        { itemId: voice.id, decision: "merge" },
        { itemId: habits.id, decision: "accept" },
      ],
      emptyDossierMarkdownArchive(),
      { body, sourceRevision: 1 },
    );
    expect(applied.profile.psychology.coreDesire).toBe("Safety.");
    expect(applied.profile.voice.diction).toContain("Soft.");
    expect(applied.profile.voice.diction).toContain("Clipped answers.");
    expect(applied.profile.behavior.habits).toContain("Checks locks");
  });

  it("refuses silent overwrite of approved canon on accept", () => {
    const profile = setFieldMeta(emptyCharacterDevelopment(), "foundation.appearance", {
      approval: "approved",
      provenance: { origin: "author", note: "", updatedAt: "2026-01-01T00:00:00.000Z" },
    });
    profile.foundation.appearance = "Black coat.";
    const body = "## Appearance\nSalt-grey cloak.\n";
    const analysis = analyzeDossierUpgrade(body, profile);
    const item = analysis.items[0]!;
    expect(item.existingAuthority).toBe("approved");
    expect(item.requiresHumanReview).toBe(true);
    const blocked = applyUpgradeDecisions(
      profile,
      analysis,
      [{ itemId: item.id, decision: "accept" }],
      emptyDossierMarkdownArchive(),
      { body, sourceRevision: 1 },
    );
    expect(blocked.profile.foundation.appearance).toBe("Black coat.");
    expect(blocked.deferredItemIds).toContain(item.id);
  });

  it("surfaces unsupported archive versions and resolves holds into draft fields", () => {
    const bad = readDossierMarkdownArchiveWithStatus({
      dossierMarkdownArchive: { version: 99, entries: [], appliedFingerprints: [] },
    });
    expect(bad.unsupportedVersion).toBe(true);
    expect(bad.problems.length).toBeGreaterThan(0);

    const analysis = analyzeDossierUpgrade("## Appearance\nCloak.\n\n## Unknowns\nWho forged the ledger?\n", emptyCharacterDevelopment());
    const mystery = analysis.items.find((item) => item.destination === "protected_unknowns")!;
    const appearance = analysis.items.find((item) => item.fieldPath === "foundation.appearance")!;
    const applied = applyUpgradeDecisions(
      emptyCharacterDevelopment(),
      analysis,
      [
        { itemId: appearance.id, decision: "defer" },
        { itemId: mystery.id, decision: "accept" },
        ...analysis.items
          .filter((item) => item.id !== appearance.id && item.id !== mystery.id)
          .map((item) => ({ itemId: item.id, decision: "defer" as const })),
      ],
      emptyDossierMarkdownArchive(),
      { body: "## Appearance\nCloak.\n\n## Unknowns\nWho forged the ledger?\n", sourceRevision: 1 },
    );
    const holdId = applied.profile.migrationHold[0]!.id;
    const deferred = updateHoldDecision(applied.profile, holdId, "deferred");
    expect(deferred.migrationHold[0]?.decision).toBe("deferred");
    const dismissed = dismissHold(deferred, holdId);
    expect(dismissed.migrationHold).toHaveLength(0);

    const heldProfile = emptyCharacterDevelopment();
    heldProfile.migrationHold = [
      {
        id: "hold_appearance",
        kind: "unclassified",
        fieldPath: "foundation.appearance",
        heading: "Appearance",
        text: "Salt-grey cloak.",
        sourceText: "Salt-grey cloak.",
        note: "test",
        decision: "retained",
      },
    ];
    const resolved = resolveHoldIntoField(heldProfile, "hold_appearance")!;
    expect(resolved.foundation.appearance).toBe("Salt-grey cloak.");
    expect(fieldMetaOf(resolved, "foundation.appearance").approval).toBe("draft");
    expect(resolved.migrationHold).toHaveLength(0);
  });

  it("keeps decision fingerprints stable across profile fills for idempotency", () => {
    const body = "## Appearance\nCloak.\n";
    const empty = analyzeDossierUpgrade(body, emptyCharacterDevelopment());
    const filled = emptyCharacterDevelopment();
    filled.foundation.appearance = "Cloak.";
    const again = analyzeDossierUpgrade(body, filled);
    expect(empty.bodyHash).toBe(again.bodyHash);
    expect(empty.fingerprint).not.toBe(again.fingerprint);
    const decisions = empty.items.map((item) => ({ itemId: item.id, decision: "accept" as const }));
    expect(upgradeDecisionFingerprint(empty.bodyHash, decisions)).toBe(
      upgradeDecisionFingerprint(again.bodyHash, decisions),
    );
  });

  it("classifies Enneagram, archetypes, narrative role, and new psychology headings", () => {
    const body = [
      "## Enneagram",
      "Type 5w4.",
      "",
      "## Primary archetype",
      "Sage",
      "",
      "## Shadow archetype",
      "Trickster — denied face",
      "",
      "## Narrative role",
      "Mentor",
      "",
      "## Core motivation",
      "To keep the record intact.",
      "",
      "## Blind spots",
      "Cannot ask for help.",
      "",
      "## Mental health",
      "Author portrayal note only.",
    ].join("\n");
    const analysis = analyzeDossierUpgrade(body, emptyCharacterDevelopment());
    expect(analysis.items.find((item) => item.fieldPath === "psychology.enneagram")?.requiresHumanReview).toBe(true);
    expect(analysis.items.find((item) => item.fieldPath === "archetypes")?.requiresHumanReview).toBe(true);
    expect(analysis.items.find((item) => item.fieldPath === "narrativeRole")?.requiresHumanReview).toBe(true);
    expect(analysis.items.find((item) => item.fieldPath === "psychology.coreMotivation")?.proposedValue).toContain(
      "keep the record",
    );
    expect(analysis.items.find((item) => item.fieldPath === "psychology.blindSpots")).toBeTruthy();
    expect(analysis.items.find((item) => item.fieldPath === "livedExperience.boundaryNote")?.destination).toBe("lived");

    const applied = applyUpgradeDecisions(
      emptyCharacterDevelopment(),
      analysis,
      analysis.items.map((item) => ({ itemId: item.id, decision: "accept" as const })),
      emptyDossierMarkdownArchive(),
      { body, sourceRevision: 1 },
    );
    expect(applied.profile.psychology.enneagram).toBe(5);
    expect(applied.profile.psychology.wing).toBe(4);
    expect(applied.profile.narrativeRole).toBe("mentor");
    expect(applied.profile.archetypes.some((item) => item.rank === "primary" && item.name === "Sage")).toBe(true);
    expect(applied.profile.archetypes.some((item) => item.rank === "shadow")).toBe(true);
    expect(applied.profile.archetypes.every((item) => item.approval !== "approved")).toBe(true);
    expect(fieldMetaOf(applied.profile, "psychology.enneagram").approval).not.toBe("approved");
    expect(applied.profile.psychology.coreMotivation).toContain("keep the record");
    expect(applied.profile.livedExperience.boundaryNote).toContain("portrayal");
    expect(applied.profile.livedExperience.aiVisibility).toBe("omit");
  });

  it("refuses silent overwrite of approved Enneagram and archetypes on re-import", () => {
    let profile = emptyCharacterDevelopment();
    profile.psychology.enneagram = 5;
    profile = setFieldMeta(profile, "psychology.enneagram", {
      approval: "approved",
      provenance: { origin: "author", note: "", updatedAt: "2026-01-01T00:00:00.000Z" },
    });
    profile.archetypes = [
      {
        id: "arch_1",
        name: "Sage",
        custom: false,
        description: "",
        rank: "primary",
        periodLabel: "",
        relationshipRecordId: null,
        evolvesFromId: null,
        evolutionNote: "",
        bookProjectId: null,
        approval: "approved",
        provenance: { origin: "author", note: "" },
      },
    ];
    const body = "## Enneagram\nType 8.\n\n## Archetypes\nRebel\n";
    const analysis = analyzeDossierUpgrade(body, profile);
    const enneagram = analysis.items.find((item) => item.fieldPath === "psychology.enneagram")!;
    const archetypes = analysis.items.find((item) => item.fieldPath === "archetypes")!;
    expect(enneagram.existingAuthority).toBe("approved");
    expect(archetypes.existingAuthority).toBe("approved");
    const blocked = applyUpgradeDecisions(
      profile,
      analysis,
      [
        { itemId: enneagram.id, decision: "accept" },
        { itemId: archetypes.id, decision: "accept" },
      ],
      emptyDossierMarkdownArchive(),
      { body, sourceRevision: 1 },
    );
    expect(blocked.profile.psychology.enneagram).toBe(5);
    expect(blocked.profile.archetypes[0]?.name).toBe("Sage");
    expect(blocked.deferredItemIds).toEqual(expect.arrayContaining([enneagram.id, archetypes.id]));
  });

  it("separates approved canon from draft notes in context slices and dedupes body", () => {
    const profile = emptyCharacterDevelopment();
    profile.foundation.appearance = "Salt-grey cloak.";
    profile.voice.diction = "Clipped.";
    const withMeta = setFieldMeta(
      setFieldMeta(profile, "foundation.appearance", {
        approval: "approved",
        provenance: { origin: "author", note: "", updatedAt: "2026-01-01T00:00:00.000Z" },
      }),
      "voice.diction",
      {
        approval: "draft",
        provenance: { origin: "imported", note: "", sourceHeading: "Voice", updatedAt: "2026-01-01T00:00:00.000Z" },
      },
    );
    withMeta.migrationHold = [
      {
        id: "hold_1",
        kind: "unclassified",
        fieldPath: "hold.unclassified",
        heading: "Odd note",
        text: "Held secret passage.",
        sourceText: "Held secret passage.",
        note: "held",
        decision: "retained",
      },
    ];
    const body = "Narrative preamble about the quay.\n\n## Appearance\nSalt-grey cloak.\n";
    const dialogue = renderCharacterContextSlice({
      title: "Mara",
      body,
      profile: withMeta,
      slice: "dialogue",
    });
    expect(dialogue).toMatch(/Established profile/i);
    expect(dialogue).toContain("Salt-grey cloak");
    expect(dialogue).toMatch(/Draft \/ Proposed notes \(not canon\)/i);
    expect(dialogue).toContain("Clipped");
    expect(dialogue).not.toContain("Held secret passage");

    const continuity = renderCharacterContextSlice({
      title: "Mara",
      body,
      profile: withMeta,
      slice: "continuity",
    });
    expect(continuity).toContain("quay");
    expect(continuity).toContain("Held secret passage");
    // Appearance section prose already represented by structured field — omit redundant heading dump.
    expect(continuity).not.toMatch(/## Appearance\nSalt-grey cloak/);
  });
});
