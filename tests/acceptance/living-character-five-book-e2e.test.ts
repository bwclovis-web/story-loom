import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyChangePackage } from "@/server/services/changePackageService";
import { inspectSelectionAssistContext } from "@/server/services/assistantContextInspect";
import { assembleCharacterWritingContexts } from "@/server/services/characterWritingContextService";
import { loadSeriesDevelopment } from "@/server/services/characterDevelopmentService";
import {
  clearContinuitySuppression,
  listContinuityLedger,
  suppressContinuityIssue,
} from "@/server/services/continuityService";
import { exportContextBundle } from "@/server/services/contextExportService";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { addReadingPin, PROJECT_PIN_SCOPE } from "@/server/services/readingPinService";
import { addRecordRelation } from "@/server/services/recordRelationService";
import { createRecord, getRecord } from "@/server/services/recordService";
import { prepareSelectionAssist } from "@/server/services/selectionAssistService";
import { createStoryEvent, linkStoryEventScene, orderStoryEvents } from "@/server/services/storyEventService";
import {
  emptyBookState,
  emptyCharacterDevelopment,
  readCharacterDevelopment,
  setFieldMeta,
  withCharacterDevelopment,
  type CharacterDevelopment,
} from "@/domain/characterDevelopment";
import { createTestDb, type TestDb } from "../helpers";

const runtime = {
  configured: true,
  model: "test-model",
  limits: {
    maxInputChars: 600_000,
    maxOutputTokens: 2_000,
    analysisOutputTokens: 2_000,
    maxRequestsPerHour: 30,
    monthlyTokenCap: 3_000_000,
    requestTimeoutSeconds: 30,
    maxToolCalls: 0,
    maxToolRounds: 0,
    maxToolResultChars: 1_000,
  },
};

function approve(profile: CharacterDevelopment, path: string): CharacterDevelopment {
  return setFieldMeta(profile, path, {
    approval: "approved",
    provenance: { origin: "author", note: "Series bible", updatedAt: "2026-01-01T00:00:00.000Z" },
  });
}

describe("Living Character Profiles — 5-book series end-to-end", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("enforces chronology, spoilers, variants, continuity, and export roundtrip across a 5-book series", async () => {
    const workspaceId = "wsp_salt_5";
    await createWorkspace(t.db, { id: workspaceId, name: "Five Book Workspace" });

    const bookIds = ["prj_salt_b1", "prj_salt_b2", "prj_salt_b3", "prj_salt_b4", "prj_salt_b5"];
    for (let i = 0; i < bookIds.length; i += 1) {
      await createProject(t.db, { id: bookIds[i]!, workspaceId, title: `Salt Book ${i + 1}` });
      await t.db.project.update({
        where: { id: bookIds[i]! },
        data: { seriesName: "Chronicles of Salt", bookName: `Book ${i + 1}` },
      });
    }

    // Story events across Book 1..5
    const evB1 = await createStoryEvent(t.db, bookIds[0]!, { title: "Book 1 Dock Arrival" });
    const evB2 = await createStoryEvent(t.db, bookIds[1]!, { title: "Book 2 Harbour Oath" });
    const evB3 = await createStoryEvent(t.db, bookIds[2]!, { title: "Book 3 Storm Crossing" });
    const evB4 = await createStoryEvent(t.db, bookIds[3]!, { title: "Book 4 Vault Opening" });
    const evB5 = await createStoryEvent(t.db, bookIds[4]!, { title: "Book 5 Tide Reckoning", planned: true });

    // Flashback -> present inside Book 4
    const evB4Flashback = await createStoryEvent(t.db, bookIds[3]!, { title: "Book 4 Flashback to Dock" });
    const evB4FlashbackRow = await t.db.storyEvent.findUniqueOrThrow({ where: { id: evB4Flashback.id } });
    await orderStoryEvents(t.db, bookIds[3]!, {
      eventId: evB4Flashback.id,
      otherEventId: evB4.id,
      direction: "before",
      expectedRevision: evB4FlashbackRow.revision,
    });
    // Cross-book chronological edges
    await t.db.storyEventOrder.createMany({
      data: [
        { id: "evo_1_2", projectId: bookIds[0]!, earlierEventId: evB1.id, laterEventId: evB2.id },
        { id: "evo_2_3", projectId: bookIds[1]!, earlierEventId: evB2.id, laterEventId: evB3.id },
        { id: "evo_3_4", projectId: bookIds[2]!, earlierEventId: evB3.id, laterEventId: evB4.id },
        { id: "evo_4_5", projectId: bookIds[3]!, earlierEventId: evB4.id, laterEventId: evB5.id },
      ],
    });

    // Protagonist Elena Kestrel (series-shared in Book 1)
    let elena = emptyCharacterDevelopment();
    elena.importance = "protagonist";
    elena.narrativeRole = "protagonist";
    elena = approve(elena, "importance");
    elena = approve(elena, "narrativeRole");
    elena.psychology.coreMotivation = "Keep the sea ledgers honest";
    elena.psychology.weaknesses = "Refuses help until the hull cracks";
    elena.psychology.enneagram = 5;
    elena.psychology.wing = 6;
    elena = approve(elena, "psychology.coreMotivation");
    elena = approve(elena, "psychology.weaknesses");
    elena = approve(elena, "psychology.enneagram");
    elena.archetypes = [
      {
        id: "arch_seeker",
        name: "Seeker",
        custom: false,
        description: "Hunts hidden truths",
        rank: "primary",
        periodLabel: "",
        relationshipRecordId: null,
        evolvesFromId: null,
        evolutionNote: "",
        bookProjectId: null,
        approval: "approved",
        provenance: { origin: "author", note: "Series bible" },
      },
      {
        id: "arch_sage",
        name: "Sage",
        custom: false,
        description: "Reads older scripts",
        rank: "secondary",
        periodLabel: "",
        relationshipRecordId: null,
        evolvesFromId: null,
        evolutionNote: "",
        bookProjectId: null,
        approval: "approved",
        provenance: { origin: "author", note: "Series bible" },
      },
    ];
    elena.voice.diction = "spare, maritime, avoids ornament";
    elena = approve(elena, "voice.diction");
    elena.livedExperience.formativeExperiences = "PRIVATE_AUTHOR_BACKSTORY_DO_NOT_LEAK";

    // Blank narrativeIndex on BookStates to verify series-order fallback across Books 1..5
    elena.bookStates = bookIds.map((bookId, idx) => ({
      ...emptyBookState(bookId),
      openingNote: `Book ${idx + 1} opening`,
      openingApproval: "approved",
      closingNote: `Book ${idx + 1} closing`,
      closingApproval: "approved",
    }));

    elena.stateChanges = [
      {
        id: "chg_uninjured",
        facet: "injury",
        presence: "set",
        text: "hands unscarred and steady",
        approval: "approved",
        planned: false,
        bookProjectId: bookIds[0]!,
        storyEventId: evB1.id,
        chapterRecordId: null,
        sceneRecordId: null,
        sequence: null,
        note: "Book 1 baseline",
        supersedesId: null,
        correctionNote: "",
        correctedAt: null,
      },
      {
        id: "chg_flashback_healthy",
        facet: "injury",
        presence: "set",
        text: "uninjured before the storm",
        approval: "approved",
        planned: false,
        bookProjectId: bookIds[3]!,
        storyEventId: evB4Flashback.id,
        chapterRecordId: null,
        sceneRecordId: null,
        sequence: null,
        note: "Book 4 flashback anchor",
        supersedesId: null,
        correctionNote: "",
        correctedAt: null,
      },
      {
        id: "chg_storm_scar",
        facet: "injury",
        presence: "set",
        text: "rope-burned scar across left palm",
        approval: "approved",
        planned: false,
        bookProjectId: bookIds[2]!,
        storyEventId: evB3.id,
        chapterRecordId: null,
        sceneRecordId: null,
        sequence: null,
        note: "Acquired in Book 3",
        supersedesId: null,
        correctionNote: "",
        correctedAt: null,
      },
      {
        id: "chg_vault_cipher",
        facet: "ability",
        presence: "set",
        text: "reads High Salt cipher",
        approval: "approved",
        planned: false,
        bookProjectId: bookIds[3]!,
        storyEventId: evB4.id,
        chapterRecordId: null,
        sceneRecordId: null,
        sequence: null,
        note: "Mastered in Book 4",
        supersedesId: null,
        correctionNote: "",
        correctedAt: null,
      },
      {
        id: "chg_b5_heal",
        facet: "injury",
        presence: "set",
        text: "scar faded to a pale silver line",
        approval: "approved",
        planned: true,
        bookProjectId: bookIds[4]!,
        storyEventId: evB5.id,
        chapterRecordId: null,
        sceneRecordId: null,
        sequence: null,
        note: "Planned Book 5 state",
        supersedesId: "chg_storm_scar",
        correctionNote: "",
        correctedAt: null,
      },
    ];

    elena.knowledge = [
      {
        id: "k_b1",
        kind: "knowledge",
        statement: "Knows the harbour bell rings twice before fog.",
        approval: "approved",
        planned: false,
        bookProjectId: bookIds[0]!,
        fromStoryEventId: evB1.id,
        untilStoryEventId: null,
        sceneRecordId: null,
        holder: "character",
        aiVisibility: "include",
        establishedFactId: null,
        provenance: { origin: "author", note: "" },
      },
      {
        id: "k_b2_reader",
        kind: "knowledge",
        statement: "READER_ONLY_IRONY_MARCUS_SENT_THE_LETTER",
        approval: "approved",
        planned: false,
        bookProjectId: bookIds[1]!,
        fromStoryEventId: evB2.id,
        untilStoryEventId: null,
        sceneRecordId: null,
        holder: "reader",
        aiVisibility: "include",
        establishedFactId: null,
        provenance: { origin: "author", note: "" },
      },
      {
        id: "k_b4_secret",
        kind: "secret",
        statement: "BOOK4_VAULT_SECRET_HER_FATHER_BUILT_THE_LOCK",
        approval: "approved",
        planned: false,
        bookProjectId: bookIds[3]!,
        fromStoryEventId: evB4.id,
        untilStoryEventId: null,
        sceneRecordId: null,
        holder: "character",
        aiVisibility: "include",
        establishedFactId: null,
        provenance: { origin: "author", note: "" },
      },
      {
        id: "k_author_omit",
        kind: "secret",
        statement: "OMIT_AUTHOR_TWIST_SHE_IS_IMMORTAL",
        approval: "approved",
        planned: false,
        bookProjectId: bookIds[0]!,
        fromStoryEventId: evB1.id,
        untilStoryEventId: null,
        sceneRecordId: null,
        holder: "character",
        aiVisibility: "omit",
        establishedFactId: null,
        provenance: { origin: "author", note: "" },
      },
      {
        id: "k_b5_planned",
        kind: "knowledge",
        statement: "PLANNED_BOOK5_TIDE_SECRET",
        approval: "approved",
        planned: true,
        bookProjectId: bookIds[4]!,
        fromStoryEventId: evB5.id,
        untilStoryEventId: null,
        sceneRecordId: null,
        holder: "character",
        aiVisibility: "include",
        establishedFactId: null,
        provenance: { origin: "author", note: "" },
      },
    ];

    elena.arcs = [
      {
        id: "arc_forgotten_b2",
        title: "Trust the harbour crew",
        description: "Learn to delegate the night watch",
        template: "positive_change",
        approval: "approved",
        movement: "progressing",
        scope: "book",
        bookProjectId: bookIds[1]!,
        parentArcId: null,
        participantRecordIds: [],
        relationId: null,
        perceptions: [],
        startingState: "Works alone",
        desiredOutcome: "Shares command",
        startingBelief: "Only I can verify the count",
        emergingTruth: "Shared trust holds",
        internalConflict: "Fear of betrayal",
        externalConflict: "Sabotage on the pier",
        stakes: "The salt fleet",
        notes: "",
        milestones: [],
      },
    ];

    const elenaId = "rec_elena_kestrel";
    await createRecord(t.db, bookIds[0]!, {
      recordId: elenaId,
      type: "character_dossier",
      title: "Elena Kestrel",
      body: "Harbour archivist across five books.",
      fields: {
        name: "Elena Kestrel",
        ...withCharacterDevelopment({}, elena),
        dossierMarkdownArchive: { version: 1, markdown: "# Private raw markdown archive" },
      },
      authorityStatus: "approved",
    });
    await t.db.record.update({ where: { id: elenaId }, data: { worldScope: "series" } });

    // Supporting, minor, and parallel-world variant characters
    let marcus = emptyCharacterDevelopment();
    marcus.importance = "supporting";
    marcus = approve(marcus, "importance");
    const marcusId = "rec_marcus_vale";
    await createRecord(t.db, bookIds[0]!, {
      recordId: marcusId,
      type: "character_dossier",
      title: "Marcus Vale",
      body: "Harbour captain.",
      fields: withCharacterDevelopment({ name: "Marcus Vale" }, marcus),
      authorityStatus: "approved",
    });
    await t.db.record.update({ where: { id: marcusId }, data: { worldScope: "series" } });

    await addRecordRelation(t.db, bookIds[0]!, {
      fromRecordId: elenaId,
      toRecordId: marcusId,
      kind: "allied_with",
    });

    let porter = emptyCharacterDevelopment();
    porter.importance = "minor";
    porter = approve(porter, "importance");
    await createRecord(t.db, bookIds[0]!, {
      recordId: "rec_quay_porter",
      type: "character_dossier",
      title: "Old Quay Porter",
      body: "Guards the south lantern.",
      fields: withCharacterDevelopment({ name: "Old Quay Porter" }, porter),
      authorityStatus: "approved",
    });

    const shadowElena = emptyCharacterDevelopment();
    shadowElena.importance = "major";
    shadowElena.variant = {
      foundationRecordId: elenaId,
      inheritedKeys: ["foundation", "voice"],
      relationshipKind: "parallel_world",
      relationshipLabel: "Glass-world mirror",
    };
    await createRecord(t.db, bookIds[0]!, {
      recordId: "rec_shadow_elena",
      type: "character_dossier",
      title: "Shadow Elena",
      body: "Parallel-world counterpart.",
      fields: withCharacterDevelopment({ name: "Shadow Elena" }, shadowElena),
      authorityStatus: "approved",
    });

    // Chapters in Book 1, Book 2, and Book 4 (flashback + present)
    const b1Prose = "Elena Kestrel checked the tide ledger at the north pier.";
    const chB1Id = "rec_b1_ch01";
    await createRecord(t.db, bookIds[0]!, {
      recordId: chB1Id,
      type: "manuscript_chapter",
      title: "Book 1 Chapter 1",
      body: b1Prose,
      authorityStatus: "draft",
    });
    const chB1 = await getRecord(t.db, bookIds[0]!, chB1Id);
    const evB1Row = await t.db.storyEvent.findUniqueOrThrow({ where: { id: evB1.id } });
    await linkStoryEventScene(t.db, bookIds[0]!, evB1.id, chB1Id, evB1Row.revision);
    await addReadingPin(t.db, bookIds[0]!, PROJECT_PIN_SCOPE, elenaId);

    const b2Prose = "Elena Kestrel counted the salt barrels along the pier before dawn.";
    const chB2Id = "rec_b2_ch01";
    await createRecord(t.db, bookIds[1]!, {
      recordId: chB2Id,
      type: "manuscript_chapter",
      title: "Book 2 Chapter 1",
      body: b2Prose,
      authorityStatus: "draft",
    });
    const evB2Row = await t.db.storyEvent.findUniqueOrThrow({ where: { id: evB2.id } });
    await linkStoryEventScene(t.db, bookIds[1]!, evB2.id, chB2Id, evB2Row.revision);

    const b4FlashbackProse = "Years earlier, Elena Kestrel gripped the wet rope with uncalloused hands.";
    const chB4FlashbackId = "rec_b4_flashback";
    await createRecord(t.db, bookIds[3]!, {
      recordId: chB4FlashbackId,
      type: "manuscript_chapter",
      title: "Book 4 Chapter 2 (Flashback)",
      body: b4FlashbackProse,
      authorityStatus: "draft",
    });
    const evB4FlashRow2 = await t.db.storyEvent.findUniqueOrThrow({ where: { id: evB4Flashback.id } });
    await linkStoryEventScene(t.db, bookIds[3]!, evB4Flashback.id, chB4FlashbackId, evB4FlashRow2.revision);

    const b4PresentProse = "At the bronze vault, Elena Kestrel traced the High Salt inscription.";
    const chB4PresentId = "rec_b4_present";
    await createRecord(t.db, bookIds[3]!, {
      recordId: chB4PresentId,
      type: "manuscript_chapter",
      title: "Book 4 Chapter 9",
      body: b4PresentProse,
      authorityStatus: "draft",
    });
    const evB4Row = await t.db.storyEvent.findUniqueOrThrow({ where: { id: evB4.id } });
    await linkStoryEventScene(t.db, bookIds[3]!, evB4.id, chB4PresentId, evB4Row.revision);

    // 1. Verify 5-book series matrix
    const overview = await loadSeriesDevelopment(t.db, bookIds[0]!);
    expect(overview.books).toHaveLength(5);
    expect(overview.rows.map((r) => r.characterId)).toEqual(
      expect.arrayContaining([elenaId, marcusId, "rec_quay_porter", "rec_shadow_elena"]),
    );

    // 2. Verify Book 1 Selection Assist + Context Inspector omit later-book secrets, reader-only irony, omit secrets, livedExperience, and Book 5 plans
    const inspectedB1 = await inspectSelectionAssistContext(t.db, runtime, {
      projectId: bookIds[0]!,
      recordId: chB1Id,
      revision: chB1.currentRevision,
      range: { start: 0, end: 25 },
      action: "rewrite",
      scopeDraftId: PROJECT_PIN_SCOPE,
    });
    const b1RefItem = inspectedB1.items.find((item) => item.kind === "reference" && item.label.includes("Elena"));
    expect(b1RefItem).toBeDefined();
    expect(b1RefItem?.preview).not.toContain("PRIVATE_AUTHOR_BACKSTORY_DO_NOT_LEAK");
    expect(b1RefItem?.preview).not.toContain("BOOK4_VAULT_SECRET");

    const preparedB1 = await prepareSelectionAssist(t.db, runtime, {
      projectId: bookIds[0]!,
      recordId: chB1Id,
      revision: chB1.currentRevision,
      range: { start: 0, end: 25 },
      action: "rewrite",
      scopeDraftId: PROJECT_PIN_SCOPE,
    });
    const b1Prompt = `${preparedB1.request.instructions}\n${preparedB1.request.input.map((m) => m.content).join("\n")}`;
    expect(b1Prompt).toContain("Seeker");
    expect(b1Prompt).toContain("Enneagram: 5 wing 6");
    expect(b1Prompt).toContain("spare, maritime");
    expect(b1Prompt).not.toContain("READER_ONLY_IRONY_MARCUS_SENT_THE_LETTER");
    expect(b1Prompt).not.toContain("BOOK4_VAULT_SECRET_HER_FATHER_BUILT_THE_LOCK");
    expect(b1Prompt).not.toContain("OMIT_AUTHOR_TWIST_SHE_IS_IMMORTAL");
    expect(b1Prompt).not.toContain("PLANNED_BOOK5_TIDE_SECRET");
    expect(b1Prompt).not.toContain("PRIVATE_AUTHOR_BACKSTORY_DO_NOT_LEAK");

    // And Book 2 series-shared character context also stays spoiler-safe
    const b2Ctx = await assembleCharacterWritingContexts(t.db, bookIds[1]!, {
      focusRecordId: chB2Id,
      mode: "drafting",
      characterRecordIds: [elenaId],
    });
    expect(b2Ctx.contexts[0]?.text).toContain("Seeker");
    expect(b2Ctx.contexts[0]?.text).not.toContain("BOOK4_VAULT_SECRET_HER_FATHER_BUILT_THE_LOCK");
    expect(b2Ctx.contexts[0]?.text).not.toContain("READER_ONLY_IRONY_MARCUS_SENT_THE_LETTER");

    // 3. Verify Book 4 flashback vs present chronology
    const flashbackCtx = await assembleCharacterWritingContexts(t.db, bookIds[3]!, {
      focusRecordId: chB4FlashbackId,
      mode: "drafting",
      characterRecordIds: [elenaId],
    });
    expect(flashbackCtx.contexts[0]?.text).toContain("uninjured before the storm");
    expect(flashbackCtx.contexts[0]?.text).not.toContain("BOOK4_VAULT_SECRET_HER_FATHER_BUILT_THE_LOCK");

    const presentCtx = await assembleCharacterWritingContexts(t.db, bookIds[3]!, {
      focusRecordId: chB4PresentId,
      mode: "drafting",
      characterRecordIds: [elenaId],
    });
    expect(presentCtx.contexts[0]?.text).toContain("BOOK4_VAULT_SECRET_HER_FATHER_BUILT_THE_LOCK");
    expect(presentCtx.contexts[0]?.text).toContain("reads High Salt cipher");

    // 4. Verify Continuity Ledger structured findings, zero false-positive anchored limitations, suppression, and zero prose mutation
    const ledger = await listContinuityLedger(t.db, bookIds[0]!);
    expect(ledger.some((item) => item.kind === "character_limitation")).toBe(false);
    const forgottenItem = ledger.find((item) => item.kind === "forgotten_arc");
    expect(forgottenItem).toBeDefined();
    expect(forgottenItem?.applicableCanon).toBeTruthy();
    expect(forgottenItem?.explanation).toBeTruthy();
    expect(forgottenItem?.suggestion).toBeTruthy();

    await suppressContinuityIssue(t.db, bookIds[0]!, { issueKey: forgottenItem!.key, reason: "resolved" });
    const afterResolved = await listContinuityLedger(t.db, bookIds[0]!);
    expect(afterResolved.some((item) => item.key === forgottenItem!.key)).toBe(false);
    await clearContinuitySuppression(t.db, bookIds[0]!, forgottenItem!.key);

    // Ensure manuscript prose was never mutated by continuity or AI context assembly
    const b2After = await getRecord(t.db, bookIds[1]!, chB2Id);
    expect(b2After.body).toBe(b2Prose);

    // 5. Verify spoiler-redacted export vs full roundtrip export + change package apply
    const redactedBundle = await exportContextBundle(t.db, bookIds[1]!, {
      recordIds: [elenaId, chB2Id],
      focusRecordId: chB2Id,
      characterMode: "drafting",
      redactCharacterSpoilers: true,
    });
    const exportedElenaRedacted = redactedBundle.records.find((r) => r.id === elenaId)!;
    const redactedText = JSON.stringify(exportedElenaRedacted.fields);
    expect(redactedText).not.toContain("dossierMarkdownArchive");
    expect(redactedText).not.toContain("PRIVATE_AUTHOR_BACKSTORY_DO_NOT_LEAK");
    expect(redactedText).not.toContain("OMIT_AUTHOR_TWIST_SHE_IS_IMMORTAL");
    expect(redactedText).not.toContain("BOOK4_VAULT_SECRET_HER_FATHER_BUILT_THE_LOCK");
    expect(redactedText).not.toContain("PLANNED_BOOK5_TIDE_SECRET");
    expect(redactedBundle.characterContexts?.[0]?.text).toContain("Seeker");

    // Full roundtrip bundle + change-package update preserves Living Profile & revision
    const fullBundle = await exportContextBundle(t.db, bookIds[0]!, {
      recordIds: [elenaId],
      characterMode: "editorial",
    });
    const exportedElenaFull = fullBundle.records.find((r) => r.id === elenaId)!;
    const applyOutcome = await applyChangePackage(
      t.db,
      {
        format: "wordly.change-package",
        formatVersion: 1,
        packageId: "pkg_five_book_e2e_1",
        workspaceId,
        projectId: bookIds[0]!,
        summary: "Update Elena bio summary without touching Living Profile",
        source: { conversationLabel: "5-book E2E" },
        approval: { status: "approved", statement: "Author approved" },
        scope: "reference",
        protectedOverrides: [],
        relatedRecords: [],
        operations: [
          {
            op: "update_record",
            recordId: elenaId,
            expectedRevision: exportedElenaFull.revision,
            changes: { body: { replace: "Harbour archivist across five books. Confirmed canon." } },
          },
        ],
      },
      { projectId: bookIds[0]! },
    );
    if (applyOutcome.status === "rejected") {
      expect(applyOutcome.issues).toEqual([]);
    }
    expect(applyOutcome.status).toBe("applied");
    const elenaAfterPkg = await getRecord(t.db, bookIds[0]!, elenaId);
    expect(elenaAfterPkg.body).toContain("Confirmed canon.");
    expect(readCharacterDevelopment(elenaAfterPkg.fields).profile.psychology.wing).toBe(6);
  });
});
