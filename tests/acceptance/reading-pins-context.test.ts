import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { startAuthorRewrite } from "@/server/services/draftService";
import { findRelevantContext } from "@/server/services/findRelevantContextService";
import { linkReference, listLinkedReferences } from "@/server/services/linkService";
import {
  addReadingPin,
  listReadingPins,
  PROJECT_PIN_SCOPE,
  removeReadingPin,
  reorderReadingPins,
  resolvePinScope,
} from "@/server/services/readingPinService";
import { createRecord } from "@/server/services/recordService";
import { searchContextReferences } from "@/server/services/searchService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("Reading pins, context search, and Find relevant context", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("scopes pins by project when there are no drafts; pin never changes links", async () => {
    expect(await resolvePinScope(t.db, IDS.project)).toBe(PROJECT_PIN_SCOPE);
    await addReadingPin(t.db, IDS.project, PROJECT_PIN_SCOPE, IDS.dossier);
    expect(await listLinkedReferences(t.db, IDS.project, IDS.chapter)).toEqual([]);

    await removeReadingPin(t.db, IDS.project, PROJECT_PIN_SCOPE, IDS.dossier);
    expect(await listReadingPins(t.db, IDS.project, PROJECT_PIN_SCOPE)).toEqual([]);

    await linkReference(t.db, IDS.project, IDS.chapter, IDS.dossier);
    await addReadingPin(t.db, IDS.project, PROJECT_PIN_SCOPE, IDS.dossier);
    await removeReadingPin(t.db, IDS.project, PROJECT_PIN_SCOPE, IDS.dossier);
    const linked = await listLinkedReferences(t.db, IDS.project, IDS.chapter);
    expect(linked.map((l) => l.recordId)).toEqual([IDS.dossier]);
  });

  it("scopes pins per draft and finds context from links, pins, and search", async () => {
    const started = await startAuthorRewrite(t.db, IDS.project);
    const authorScope = await resolvePinScope(t.db, IDS.project, started.authorDraft.id);
    expect(authorScope).toBe(started.authorDraft.id);

    const world = await createRecord(t.db, IDS.project, {
      type: "worldbuilding",
      title: "Harbour Guide",
      body: "# Docks\n\nThe quay at dusk.\n\n## Lantern alley\n\nQuiet lamps.",
      authorityStatus: "approved",
      fields: { name: "Old Harbour", aliases: ["The Quay"] },
    });
    const worldId = world.outcomes[0].recordId;

    await addReadingPin(t.db, IDS.project, started.zeroDraft.id, worldId);
    expect(await listReadingPins(t.db, IDS.project, authorScope)).toEqual([]);
    await addReadingPin(t.db, IDS.project, authorScope, worldId);

    const authorChapter = (
      await t.db.record.findMany({
        where: { projectId: IDS.project, draftId: started.authorDraft.id, type: "manuscript_chapter" },
      })
    )[0]!;
    await linkReference(t.db, IDS.project, authorChapter.id, worldId);

    const hits = await searchContextReferences(t.db, { projectId: IDS.project, query: "Lantern" });
    expect(hits.some((h) => h.id === worldId && h.matchedIn === "section")).toBe(true);
    const aliasHits = await searchContextReferences(t.db, { projectId: IDS.project, query: "Quay" });
    expect(aliasHits.some((h) => h.id === worldId && (h.matchedIn === "aliases" || h.matchedIn === "name"))).toBe(true);

    const found = await findRelevantContext(t.db, {
      projectId: IDS.project,
      question: "What about the harbour lamps?",
      manuscript: { recordId: authorChapter.id },
      draftScopeId: authorScope,
      includePinnedZeroDraft: false,
    });
    expect(found.candidates.some((c) => c.recordId === worldId && c.labels.includes("linked"))).toBe(true);
    expect(found.snapshot.items.every((i) => typeof i.revisionNumber === "number")).toBe(true);

    const withZero = await findRelevantContext(t.db, {
      projectId: IDS.project,
      question: "harbour",
      manuscript: { recordId: authorChapter.id },
      draftScopeId: authorScope,
      includePinnedZeroDraft: true,
    });
    expect(withZero.candidates.some((c) => c.recordId === worldId)).toBe(true);

    await reorderReadingPins(t.db, IDS.project, authorScope, [worldId]);
  });

  it("round-trips ordered reading pins in backups; omit restores empty", async () => {
    await addReadingPin(t.db, IDS.project, PROJECT_PIN_SCOPE, IDS.dossier);
    const world = await createRecord(t.db, IDS.project, {
      type: "worldbuilding",
      title: "Second ref",
      body: "Text",
      authorityStatus: "draft",
    });
    const secondId = world.outcomes[0].recordId;
    await addReadingPin(t.db, IDS.project, PROJECT_PIN_SCOPE, secondId);
    await reorderReadingPins(t.db, IDS.project, PROJECT_PIN_SCOPE, [secondId, IDS.dossier]);

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.readingPins?.length).toBe(2);
    expect(backup.counts.readingPins).toBe(2);
    expect(backup.readingPins?.[0]?.recordId).toBe(secondId);

    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const projectId = restored.projects[0]!.id;
      const pins = await listReadingPins(target.db, projectId, PROJECT_PIN_SCOPE);
      expect(pins.map((p) => p.title)).toEqual(["Second ref", "Mara Venn"]);
    } finally {
      await target.cleanup();
    }

    // Backups that omit readingPins restore with an empty list.
    await t.db.readingPin.deleteMany({});
    const emptyBackup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(emptyBackup.readingPins ?? []).toEqual([]);
    const emptyTarget = await createTestDb();
    try {
      const outcome = await restoreWorkspaceBackup(emptyTarget.db, emptyBackup, { idStrategy: "remap" });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(await listReadingPins(emptyTarget.db, outcome.projects[0]!.id, PROJECT_PIN_SCOPE)).toEqual([]);
    } finally {
      await emptyTarget.cleanup();
    }
  });
});
