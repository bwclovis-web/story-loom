import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DOSSIER_MARKDOWN_ARCHIVE_KEY,
  readDossierMarkdownArchive,
} from "@/domain/characterDossierUpgrade";
import {
  emptyCharacterDevelopment,
  readCharacterDevelopment,
  withCharacterDevelopment,
} from "@/domain/characterDevelopment";
import { applyChangePackage, previewChangePackage } from "@/server/services/changePackageService";
import {
  applyCharacterDossierUpgrade,
  buildCharacterDossierUpgradePackage,
  previewCharacterDossierUpgrade,
  previewProjectDossierUpgrades,
} from "@/server/services/characterDossierUpgradeService";
import { getRecord, restoreRecordFromRevision, updateRecord } from "@/server/services/recordService";
import { createTestDb, IDS, seedProject, snapshotState, type TestDb } from "../helpers";

const FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "character-dossier-upgrade.md"), "utf8");

describe("character dossier upgrade workflow", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: 1,
      body: FIXTURE,
    });
  });
  afterEach(() => t.cleanup());

  it("leaves existing dossiers usable without migration and lists project upgrades", async () => {
    const before = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(before.fields.characterDevelopment).toBeUndefined();
    expect(before.body).toContain("## Appearance");

    const project = await previewProjectDossierUpgrades(t.db, IDS.project);
    expect(project.dossiers).toHaveLength(1);
    expect(project.dossiers[0]?.itemCount).toBeGreaterThan(0);
    expect(project.dossiers[0]?.alreadyMigrated).toBe(false);

    const preview = await previewCharacterDossierUpgrade(t.db, IDS.project, IDS.dossier);
    expect(preview.summary.total).toBeGreaterThan(0);
    expect(preview.analysis.items.every((item) => item.sourceText.length > 0)).toBe(true);
  });

  it("applies accepted items transactionally, archives Markdown, and stays idempotent", async () => {
    const preview = await previewCharacterDossierUpgrade(t.db, IDS.project, IDS.dossier);
    const appearance = preview.analysis.items.find((item) => item.fieldPath === "foundation.appearance")!;
    const skills = preview.analysis.items.find((item) => item.fieldPath === "capabilities.skills")!;
    const mystery = preview.analysis.items.find((item) => item.destination === "protected_unknowns")!;

    const decisions = preview.analysis.items.map((item) => {
      if (item.id === appearance.id || item.id === skills.id || item.id === mystery.id) {
        return { itemId: item.id, decision: "accept" as const };
      }
      return { itemId: item.id, decision: "defer" as const };
    });

    const first = await applyCharacterDossierUpgrade(t.db, IDS.project, {
      recordId: IDS.dossier,
      previewToken: preview.previewToken,
      decisions,
    });
    expect(first.status).toBe("applied");
    if (first.status !== "applied") return;

    const after = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(after.body).toBe(FIXTURE);
    const profile = readCharacterDevelopment(after.fields).profile;
    expect(profile.foundation.appearance).toContain("Salt-grey cloak");
    expect(profile.capabilities.skills).toContain("Ledgers");
    expect(profile.migrationHold.some((item) => item.kind === "protected_unknowns")).toBe(true);
    expect(profile.arcs).toEqual([]);
    const archive = readDossierMarkdownArchive(after.fields);
    expect(archive.entries).toHaveLength(1);
    expect(archive.entries[0]?.body).toBe(FIXTURE);

    const secondPreview = await previewCharacterDossierUpgrade(t.db, IDS.project, IDS.dossier);
    const second = await applyCharacterDossierUpgrade(t.db, IDS.project, {
      recordId: IDS.dossier,
      previewToken: secondPreview.previewToken,
      decisions: secondPreview.analysis.items.map((item) => ({
        itemId: item.id,
        decision: item.id === appearance.id || item.id === skills.id || item.id === mystery.id ? ("accept" as const) : ("defer" as const),
      })),
    });
    expect(second.status).toBe("already_applied");
    expect((await getRecord(t.db, IDS.project, IDS.dossier)).currentRevision).toBe(after.currentRevision);
  });

  it("refuses a stale preview and leaves data unchanged on failure", async () => {
    const preview = await previewCharacterDossierUpgrade(t.db, IDS.project, IDS.dossier);
    const before = await snapshotState(t.db);

    await updateRecord(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: preview.revision,
      body: `${FIXTURE}\n\n## Notes\nExtra line.\n`,
    });

    const result = await applyCharacterDossierUpgrade(t.db, IDS.project, {
      recordId: IDS.dossier,
      previewToken: preview.previewToken,
      decisions: preview.analysis.items.map((item) => ({ itemId: item.id, decision: "accept" as const })),
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.issues.some((issue) => issue.code === "STALE_PREVIEW")).toBe(true);
    }

    const after = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(after.fields.characterDevelopment).toBeUndefined();
    expect(after.fields[DOSSIER_MARKDOWN_ARCHIVE_KEY]).toBeUndefined();
    // Body changed from the intervening edit; upgrade itself did not write profile fields.
    expect(after.body).toContain("Extra line");
    const snap = await snapshotState(t.db);
    expect(snap.records.find((row) => row.id === IDS.dossier)?.fields).toBe(
      before.records.find((row) => row.id === IDS.dossier)?.fields,
    );
  });

  it("does not create a duplicate character record", async () => {
    const preview = await previewCharacterDossierUpgrade(t.db, IDS.project, IDS.dossier);
    const item = preview.analysis.items.find((row) => row.fieldPath === "foundation.appearance")!;
    await applyCharacterDossierUpgrade(t.db, IDS.project, {
      recordId: IDS.dossier,
      previewToken: preview.previewToken,
      decisions: [
        { itemId: item.id, decision: "accept" },
        ...preview.analysis.items.filter((row) => row.id !== item.id).map((row) => ({ itemId: row.id, decision: "defer" as const })),
      ],
    });
    const dossiers = await t.db.record.findMany({ where: { projectId: IDS.project, type: "character_dossier" } });
    expect(dossiers).toHaveLength(1);
    expect(dossiers[0]?.id).toBe(IDS.dossier);
  });

  it("supports imported Markdown analysis without replacing the stored body until apply of profile fields", async () => {
    const imported = `## Appearance\nImported cloak.\n\n## Voice\nImported voice.\n`;
    const preview = await previewCharacterDossierUpgrade(t.db, IDS.project, IDS.dossier, { markdownOverride: imported });
    expect(preview.analysis.items.map((item) => item.proposedValue)).toEqual(
      expect.arrayContaining(["Imported cloak.", "Imported voice."]),
    );
    const appearance = preview.analysis.items.find((item) => item.fieldPath === "foundation.appearance")!;
    const applied = await applyCharacterDossierUpgrade(t.db, IDS.project, {
      recordId: IDS.dossier,
      previewToken: preview.previewToken,
      markdownOverride: imported,
      decisions: [
        { itemId: appearance.id, decision: "accept" },
        ...preview.analysis.items.filter((item) => item.id !== appearance.id).map((item) => ({ itemId: item.id, decision: "reject" as const })),
      ],
    });
    expect(applied.status).toBe("applied");
    const after = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(after.body).toBe(FIXTURE);
    expect(readCharacterDevelopment(after.fields).profile.foundation.appearance).toBe("Imported cloak.");
    expect(readDossierMarkdownArchive(after.fields).entries[0]?.body).toBe(imported);
  });

  it("exports a change package that previews and applies through the package workflow", async () => {
    const preview = await previewCharacterDossierUpgrade(t.db, IDS.project, IDS.dossier);
    const appearance = preview.analysis.items.find((item) => item.fieldPath === "foundation.appearance")!;
    const decisions = [
      { itemId: appearance.id, decision: "accept" as const },
      ...preview.analysis.items.filter((item) => item.id !== appearance.id).map((item) => ({ itemId: item.id, decision: "defer" as const })),
    ];
    const built = await buildCharacterDossierUpgradePackage(t.db, IDS.project, {
      recordId: IDS.dossier,
      previewToken: preview.previewToken,
      decisions,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.pkg.approval.status).toBe("proposed");
    const proposedPreview = await previewChangePackage(t.db, built.pkg, { projectId: IDS.project });
    expect(proposedPreview.canApply).toBe(false);

    // Author marks the package approved, then applies through Import package.
    const pkg = {
      ...built.pkg,
      approval: { status: "approved" as const, statement: "Author approved upgrade package" },
    };
    const packagePreview = await previewChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(packagePreview.status).toBe("valid");
    expect(packagePreview.canApply).toBe(true);

    const applied = await applyChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(applied.status).toBe("applied");

    const after = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(readCharacterDevelopment(after.fields).profile.foundation.appearance).toContain("Salt-grey cloak");
    expect(after.body).toBe(FIXTURE);
  });

  it("recovers prior profile via revision restore and keeps Markdown archive readable", async () => {
    const current = await getRecord(t.db, IDS.project, IDS.dossier);
    const prior = emptyCharacterDevelopment();
    prior.foundation.appearance = "Before upgrade.";
    const seeded = await updateRecord(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: current.currentRevision,
      fields: withCharacterDevelopment(current.fields, prior),
    });
    const revisionBefore = seeded.outcomes.find((item) => item.recordId === IDS.dossier)?.newRevision ?? 2;

    const preview = await previewCharacterDossierUpgrade(t.db, IDS.project, IDS.dossier);
    const appearance = preview.analysis.items.find((item) => item.fieldPath === "foundation.appearance")!;
    const upgrade = await applyCharacterDossierUpgrade(t.db, IDS.project, {
      recordId: IDS.dossier,
      previewToken: preview.previewToken,
      decisions: [
        { itemId: appearance.id, decision: "accept" },
        ...preview.analysis.items.filter((item) => item.id !== appearance.id).map((item) => ({ itemId: item.id, decision: "defer" as const })),
      ],
    });
    expect(upgrade.status).toBe("applied");

    const upgraded = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(readCharacterDevelopment(upgraded.fields).profile.foundation.appearance).toContain("Salt-grey cloak");
    expect(readDossierMarkdownArchive(upgraded.fields).entries[0]?.body).toContain("## Appearance");

    await restoreRecordFromRevision(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: upgraded.currentRevision,
      fromRevisionNumber: revisionBefore,
      includeFields: true,
    });
    const restored = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(readCharacterDevelopment(restored.fields).profile.foundation.appearance).toBe("Before upgrade.");
    expect(restored.body).toBe(FIXTURE);
  });

  it("never promotes proposal-tagged Markdown to approved canon on apply", async () => {
    const preview = await previewCharacterDossierUpgrade(t.db, IDS.project, IDS.dossier);
    const proposed = preview.analysis.items.find((item) => item.authorityHint === "proposed")!;
    const result = await applyCharacterDossierUpgrade(t.db, IDS.project, {
      recordId: IDS.dossier,
      previewToken: preview.previewToken,
      decisions: [
        { itemId: proposed.id, decision: "accept" },
        ...preview.analysis.items.filter((item) => item.id !== proposed.id).map((item) => ({ itemId: item.id, decision: "reject" as const })),
      ],
    });
    expect(result.status).toBe("applied");
    const profile = readCharacterDevelopment((await getRecord(t.db, IDS.project, IDS.dossier)).fields).profile;
    expect(profile.psychology.coreFear === "" || profile.livedExperience.approval !== "approved").toBe(true);
    if (profile.psychology.coreFear) {
      // Fear was proposed — if written to psychology it is still plain text without an approved arc/knowledge stamp.
      expect(profile.arcs.every((arc) => arc.approval !== "approved")).toBe(true);
    }
  });
});
