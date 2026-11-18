import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { createBoard, addRecordCard } from "@/server/services/boardService";
import {
  acceptEstablishedFact,
  addFactEvidence,
  extractCandidateFactsFromSubject,
  listEstablishedFactsForSubject,
  previewBoardAskContext,
  proposeExtractedFacts,
  runCharacterKnowledgeCheck,
} from "@/server/services/establishedFactService";
import { updateRecord } from "@/server/services/recordService";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("Established-in facts", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("offers extracted facts for review, accepts them, and links passage evidence", async () => {
    const pending = await extractCandidateFactsFromSubject(t.db, IDS.project, IDS.dossier, "zero_draft");
    expect(pending.some((f) => f.status === "pending")).toBe(true);

    const offered = await proposeExtractedFacts(t.db, IDS.project, {
      subjectRecordId: IDS.dossier,
      evidenceKind: "zero_draft",
      statements: ["Mara checks the ledger every morning."],
    });
    const fact = offered.find((f) => f.statement.includes("ledger"))!;
    expect(fact.status).toBe("pending");

    const accepted = await acceptEstablishedFact(t.db, IDS.project, fact.id);
    expect(accepted.status).toBe("accepted");

    const start = CHAPTER_PROSE.indexOf("Mara Venn");
    const withEvidence = await addFactEvidence(t.db, IDS.project, fact.id, {
      sourceRecordId: IDS.chapter,
      passageStart: start,
      passageEnd: start + "Mara Venn".length,
    });
    expect(withEvidence.evidence).toHaveLength(1);
    expect(withEvidence.evidence[0].evidenceKind).toBe("zero_draft");
    expect(withEvidence.evidence[0].needsRecheck).toBe(false);
    expect(withEvidence.evidence[0].passageExcerpt).toBe("Mara Venn");
  });

  it("flags evidence for recheck when the cited source revision changes", async () => {
    const [fact] = await proposeExtractedFacts(t.db, IDS.project, {
      subjectRecordId: IDS.dossier,
      evidenceKind: "zero_draft",
      statements: ["Mara is an archivist."],
    });
    await acceptEstablishedFact(t.db, IDS.project, fact.id);
    const start = CHAPTER_PROSE.indexOf("ledger");
    await addFactEvidence(t.db, IDS.project, fact.id, {
      sourceRecordId: IDS.chapter,
      passageStart: start,
      passageEnd: start + 6,
    });

    await updateRecord(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: 1,
      body: `${CHAPTER_PROSE} The salt dried overnight.`,
      unlockProtected: true,
    });

    const list = await listEstablishedFactsForSubject(t.db, IDS.project, IDS.dossier);
    const evidence = list.find((f) => f.id === fact.id)!.evidence[0];
    expect(evidence.needsRecheck).toBe(true);
  });

  it("keeps planned, zero-draft, and author-rewrite streams distinct", async () => {
    await proposeExtractedFacts(t.db, IDS.project, {
      subjectRecordId: IDS.dossier,
      evidenceKind: "planned",
      statements: ["Outline: Mara finds the wet ledger."],
    });
    await proposeExtractedFacts(t.db, IDS.project, {
      subjectRecordId: IDS.dossier,
      evidenceKind: "author_rewrite",
      statements: ["Rewrite: Mara hesitates at the quay."],
    });
    const list = await listEstablishedFactsForSubject(t.db, IDS.project, IDS.dossier);
    const kinds = new Set(list.map((f) => f.evidenceKind));
    expect(kinds.has("planned")).toBe(true);
    expect(kinds.has("author_rewrite")).toBe(true);
  });

  it("runs a character knowledge check scoped to a scene and reports gaps", async () => {
    const [fact] = await proposeExtractedFacts(t.db, IDS.project, {
      subjectRecordId: IDS.dossier,
      evidenceKind: "zero_draft",
      statements: ["Mara secretly owns a salt compass."],
    });
    await acceptEstablishedFact(t.db, IDS.project, fact.id);

    const result = await runCharacterKnowledgeCheck(t.db, IDS.project, {
      subjectRecordId: IDS.dossier,
      sceneId: IDS.chapter,
      draftId: null,
    });
    expect(result.passagesChecked.length).toBeGreaterThan(0);
    expect(result.nameFormsUsed).toContain("Mara");
    expect(result.gaps.some((g) => g.factId === fact.id)).toBe(true);
  });

  it("previews board ask context and round-trips facts in backups", async () => {
    const board = await createBoard(t.db, IDS.project, { title: "Continuity", templateKey: "blank" });
    await addRecordCard(t.db, IDS.project, board.id, { recordId: IDS.dossier, x: 10, y: 20 });
    await addRecordCard(t.db, IDS.project, board.id, { recordId: IDS.world, x: 40, y: 60 });

    const preview = await previewBoardAskContext(t.db, IDS.project, board.id);
    expect(preview.records.map((r) => r.recordId).sort()).toEqual([IDS.dossier, IDS.world].sort());
    expect(preview.suggestedPrompt).toContain("Continuity");

    const [fact] = await proposeExtractedFacts(t.db, IDS.project, {
      subjectRecordId: IDS.dossier,
      evidenceKind: "zero_draft",
      statements: ["Backup fact about Mara."],
    });
    await acceptEstablishedFact(t.db, IDS.project, fact.id);
    const start = CHAPTER_PROSE.indexOf("Mara");
    await addFactEvidence(t.db, IDS.project, fact.id, {
      sourceRecordId: IDS.chapter,
      passageStart: start,
      passageEnd: start + 4,
    });

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.establishedFacts?.length).toBeGreaterThanOrEqual(1);
    expect(backup.factEvidence?.length).toBeGreaterThanOrEqual(1);
    expect(backup.counts.establishedFacts).toBe(backup.establishedFacts!.length);

    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const projectId = restored.projects[0]!.id;
      const dossiers = await target.db.record.findMany({
        where: { projectId, type: "character_dossier", trashedAt: null },
        select: { id: true },
      });
      expect(dossiers).toHaveLength(1);
      const facts = await listEstablishedFactsForSubject(target.db, projectId, dossiers[0]!.id);
      expect(facts.some((f) => f.statement.includes("Backup fact"))).toBe(true);
      expect(facts.find((f) => f.statement.includes("Backup fact"))!.evidence.length).toBe(1);
    } finally {
      await target.cleanup();
    }
  });
});
