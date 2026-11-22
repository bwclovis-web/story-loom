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

  it("keeps unknown development keys and refuses an unsupported version without wiping", async () => {
    const current = await getRecord(t.db, IDS.project, IDS.dossier);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: current.currentRevision,
      fields: {
        ...current.fields,
        characterDevelopment: {
          version: 1,
          futureNote: "keep me",
          psychology: { coreDesire: "to keep the record" },
        },
      },
    });
    const profile = emptyCharacterDevelopment();
    profile.psychology.coreDesire = "to keep the salt";
    profile.foundation.appearance = "salt-grey cloak";
    await saveCharacterDevelopment(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: 2,
      profile,
    });
    const saved = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(saved.body).toBe("Archivist. Thirty years old.");
    expect(saved.fields.name).toBe("Mara Venn");
    const blob = saved.fields.characterDevelopment as { futureNote?: string; psychology?: { coreDesire?: string } };
    expect(blob.futureNote).toBe("keep me");
    expect(blob.psychology?.coreDesire).toBe("to keep the salt");

    // Plant an unsupported version outside mutationService (packages and saves refuse to write it).
    await t.db.record.update({
      where: { id: IDS.dossier },
      data: {
        fields: JSON.stringify({
          ...saved.fields,
          characterDevelopment: { version: 9, futureNote: "do not wipe" },
        }),
      },
    });
    const unsupported = await getRecord(t.db, IDS.project, IDS.dossier);
    await expect(
      saveCharacterDevelopment(t.db, IDS.project, {
        recordId: IDS.dossier,
        expectedRevision: unsupported.currentRevision,
        profile: emptyCharacterDevelopment(),
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    const untouched = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(untouched.fields.characterDevelopment).toEqual({ version: 9, futureNote: "do not wipe" });
  });

  it("saves Phase 1 behavior and capabilities without rewriting dossier Markdown", async () => {
    const profile = emptyCharacterDevelopment();
    profile.importance = "supporting";
    profile.foundation.culturalIdentity = "Harrowgate";
    profile.behavior.socialBehavior = "Warm in private, cool in public";
    profile.capabilities.magicalAbilities = "None she admits";
    profile.capabilities.linkedRecordIds = ["rec_world_ref_01"];
    const saved = await saveCharacterDevelopment(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: 1,
      profile,
    });
    expect(saved.revision).toBe(2);
    const dossier = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(dossier.body).toBe("Archivist. Thirty years old.");
    expect(dossier.fields.name).toBe("Mara Venn");
    const blob = dossier.fields.characterDevelopment as {
      behavior?: { socialBehavior?: string };
      capabilities?: { linkedRecordIds?: string[] };
    };
    expect(blob.behavior?.socialBehavior).toBe("Warm in private, cool in public");
    expect(blob.capabilities?.linkedRecordIds).toEqual(["rec_world_ref_01"]);
  });

  it("saves psychology extensions and shadow archetypes without rewriting dossier Markdown", async () => {
    const profile = emptyCharacterDevelopment();
    profile.psychology.coreMotivation = "Keep the salt ledger";
    profile.psychology.blindSpots = "Cannot ask for help";
    profile.psychology.selfPerception = "Reliable";
    profile.psychology.externalPerception = "Cold";
    profile.narrativeRole = "mentor";
    profile.archetypes = [
      {
        id: "arch_primary",
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
      {
        id: "arch_shadow",
        name: "Trickster",
        custom: false,
        description: "",
        rank: "shadow",
        periodLabel: "",
        relationshipRecordId: null,
        evolvesFromId: "arch_primary",
        evolutionNote: "Denied face",
        bookProjectId: null,
        approval: "draft",
        provenance: { origin: "author", note: "" },
      },
    ];
    const saved = await saveCharacterDevelopment(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: 1,
      profile,
    });
    expect(saved.revision).toBe(2);
    const dossier = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(dossier.body).toBe("Archivist. Thirty years old.");
    const blob = dossier.fields.characterDevelopment as {
      psychology?: { coreMotivation?: string; blindSpots?: string };
      narrativeRole?: string;
      archetypes?: Array<{ rank: string; evolvesFromId?: string | null }>;
    };
    expect(blob.psychology?.coreMotivation).toBe("Keep the salt ledger");
    expect(blob.psychology?.blindSpots).toBe("Cannot ask for help");
    expect(blob.narrativeRole).toBe("mentor");
    expect(blob.archetypes?.map((item) => item.rank)).toEqual(["primary", "shadow"]);
    expect(blob.archetypes?.[1]?.evolvesFromId).toBe("arch_primary");
  });

  it("rejects a change package that sets an invalid character development object", async () => {
    const current = await getRecord(t.db, IDS.project, IDS.dossier);
    const pkg = makePackage({
      packageId: "pkg_character_bad_version",
      operations: [
        {
          op: "update_record",
          recordId: IDS.dossier,
          expectedRevision: current.currentRevision,
          changes: { fields: { set: { characterDevelopment: { version: 9 } } } },
        },
      ],
    });
    const outcome = await applyChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(outcome.status).not.toBe("applied");
    const dossier = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(dossier.fields.characterDevelopment).toBeUndefined();
    expect(dossier.currentRevision).toBe(current.currentRevision);
  });
});
