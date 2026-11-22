import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyChangePackage } from "@/server/services/changePackageService";
import {
  loadSeriesDevelopment,
  saveCharacterDevelopment,
} from "@/server/services/characterDevelopmentService";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import { createProject } from "@/server/services/projectService";
import { createRecord, getRecord, setProtection, updateRecord } from "@/server/services/recordService";
import { emptyCharacterDevelopment, withCharacterDevelopment } from "@/domain/characterDevelopment";
import { CHAPTER_PROSE, createTestDb, IDS, makePackage, seedProject, type TestDb } from "../helpers";

describe("character development on the dossier", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(() => t.cleanup());

  it("leaves an existing dossier unchanged until a profile is saved", async () => {
    const before = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(before.fields.characterDevelopment).toBeUndefined();
    expect(before.body).toContain("Archivist");
    const overview = await loadSeriesDevelopment(t.db, IDS.project);
    expect(overview.standalone).toBe(true);
    expect(overview.rows).toHaveLength(1);
  });

  it("saves optional notes without touching the manuscript or the dossier prose", async () => {
    const profile = emptyCharacterDevelopment();
    profile.importance = "supporting";
    profile.narrativeRole = "mentor";
    profile.psychology.enneagram = 5;
    profile.psychology.wing = 4;
    profile.arcs = [
      {
        id: "arc_series_a1",
        title: "Keeps the archive",
        description: "",
        template: "flat",
        approval: "approved",
        movement: "progressing",
        scope: "series",
        bookProjectId: null,
        parentArcId: null,
        participantRecordIds: [IDS.dossier],
        relationId: null,
        perceptions: [
          { recordId: IDS.dossier, feeling: "duty", belief: "The record must last" },
          { recordId: "rec_other_person", feeling: "awe", belief: "She knows more" },
        ],
        startingState: "",
        desiredOutcome: "",
        startingBelief: "",
        emergingTruth: "",
        internalConflict: "",
        externalConflict: "",
        stakes: "",
        notes: "",
        milestones: [],
      },
    ];
    const saved = await saveCharacterDevelopment(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: 1,
      profile,
    });
    const dossier = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(saved.revision).toBe(2);
    expect(dossier.body).toBe("Archivist. Thirty years old.");
    expect(dossier.fields.name).toBe("Mara Venn");
    expect(dossier.authorityStatus).toBe("approved");
    const chapter = await getRecord(t.db, IDS.project, IDS.chapter);
    expect(chapter.body).toBe(CHAPTER_PROSE);
    expect(chapter.currentRevision).toBe(1);
  });

  it("refuses a wing that is not adjacent and does not write", async () => {
    const profile = emptyCharacterDevelopment();
    profile.psychology.enneagram = 2;
    profile.psychology.wing = 8;
    await expect(
      saveCharacterDevelopment(t.db, IDS.project, { recordId: IDS.dossier, expectedRevision: 1, profile }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    expect((await getRecord(t.db, IDS.project, IDS.dossier)).currentRevision).toBe(1);
  });

  it("does not rewrite an approved book state while editing another book", async () => {
    const profile = emptyCharacterDevelopment();
    profile.bookStates = [
      {
        projectId: "book-one",
        narrativeIndex: 1,
        openingNote: "Certain",
        closingNote: "Still certain",
        opening: [{ facet: "belief", presence: "set", text: "The ledger is dry" }],
        closing: [],
        openingApproval: "approved",
        closingApproval: "approved",
      },
    ];
    await saveCharacterDevelopment(t.db, IDS.project, { recordId: IDS.dossier, expectedRevision: 1, profile });
    const edited = structuredClone(profile);
    edited.bookStates[0]!.opening = [{ facet: "belief", presence: "set", text: "Changed in secret" }];
    edited.psychology.coreDesire = "A new note for book three";
    await expect(
      saveCharacterDevelopment(t.db, IDS.project, { recordId: IDS.dossier, expectedRevision: 2, profile: edited }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    const kept = await getRecord(t.db, IDS.project, IDS.dossier);
    const stored = kept.fields.characterDevelopment as { bookStates: Array<{ opening: unknown[] }> };
    expect(stored.bookStates[0]?.opening).toEqual([{ facet: "belief", presence: "set", text: "The ledger is dry" }]);
  });

  it("keeps the profile when an older change package sets a different field", async () => {
    const profile = emptyCharacterDevelopment();
    profile.importance = "recurring";
    const current = await getRecord(t.db, IDS.project, IDS.dossier);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: current.currentRevision,
      fields: withCharacterDevelopment(current.fields, profile),
    });
    const pkg = makePackage({
      packageId: "pkg_character_age_only",
      operations: [
        {
          op: "update_record",
          recordId: IDS.dossier,
          expectedRevision: 2,
          changes: { fields: { set: { age: 34 } } },
        },
      ],
    });
    const outcome = await applyChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(outcome.status).toBe("applied");
    const dossier = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(dossier.fields.age).toBe(34);
    expect(dossier.fields.name).toBe("Mara Venn");
    expect((dossier.fields.characterDevelopment as { importance: string }).importance).toBe("recurring");
    expect((await getRecord(t.db, IDS.project, IDS.chapter)).protected).toBe(true);
    expect((await getRecord(t.db, IDS.project, IDS.chapter)).body).toBe(CHAPTER_PROSE);
  });

  it("refuses a protected dossier without an unlock, and refuses another project", async () => {
    await setProtection(t.db, IDS.project, IDS.dossier, true);
    await expect(
      saveCharacterDevelopment(t.db, IDS.project, {
        recordId: IDS.dossier,
        expectedRevision: 1,
        profile: emptyCharacterDevelopment(),
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    await createProject(t.db, { id: "prj_other_book", workspaceId: IDS.workspace, title: "Other book" });
    await expect(
      saveCharacterDevelopment(t.db, "prj_other_book", {
        recordId: IDS.dossier,
        expectedRevision: 1,
        profile: emptyCharacterDevelopment(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
