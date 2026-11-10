import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProposalDraft } from "@/assistant/proposalOutput";
import type { AssistantProvider, ProviderEvent, StructuredResult } from "@/assistant/provider";
import type { ChangePackageV1 } from "@/changePackage/schema.v1";
import { approvedPackage, listPendingProposalsForRecord, runProposalTurn } from "@/server/services/assistantProposalService";
import { createConversation, prepareTurn, type AssistantRuntime } from "@/server/services/assistantService";
import { applyChangePackage } from "@/server/services/changePackageService";
import { linkReference, listLinkingRecords } from "@/server/services/linkService";
import { applyMarkdownImport, listImportedFilesForRecord } from "@/server/services/markdownImportService";
import { createRecord } from "@/server/services/recordService";
import { listOpenReviewItemsForRecord, resolveReviewItem } from "@/server/services/reviewService";
import { createTestDb, IDS, makePackage, seedProject, snapshotState, type TestDb } from "../helpers";

/*
 * Read-only context shown beside a reference document: linking chapters and
 * scenes, open review items, unapplied assistant proposals and imported
 * files. Invented content only; the model is scripted.
 */

const runtime: AssistantRuntime = {
  configured: true,
  model: "test-model",
  limits: { maxInputChars: 30_000, maxOutputTokens: 2_000, maxRequestsPerHour: 100, monthlyTokenCap: 10_000_000, requestTimeoutSeconds: 60 },
};
const usage = { inputTokens: 300, outputTokens: 120, totalTokens: 420 };

function scriptedProposal(draft: ProposalDraft): AssistantProvider {
  return {
    // eslint-disable-next-line require-yield
    async *stream(): AsyncGenerator<ProviderEvent> {
      throw new Error("not a discussion");
    },
    async structured(): Promise<StructuredResult> {
      return { status: "complete", text: JSON.stringify(draft), responseId: "resp_ctx", usage };
    },
  };
}

async function propose(draft: ProposalDraft) {
  const conv = await createConversation(t.db, IDS.project);
  const turn = await prepareTurn(t.db, runtime, {
    kind: "ask",
    mode: "proposal",
    projectId: IDS.project,
    conversationId: conv.id,
    question: "Prepare the change.",
    selection: { references: [IDS.dossier, IDS.world].map((recordId) => ({ recordId, revision: 1 })), manuscript: null, includeMessageIds: [] },
  });
  const result = await runProposalTurn(t.db, scriptedProposal(draft), turn, new AbortController().signal);
  return { conv, proposalId: result.proposalId! };
}

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
  await seedProject(t.db);
});

afterEach(async () => {
  await t.cleanup();
});

describe("reference context", () => {
  it("lists the chapters and scenes that link to a reference, and nothing else", async () => {
    await createRecord(t.db, IDS.project, {
      recordId: "rec_test_scene_quay",
      type: "manuscript_scene",
      title: "Scene 1: The quay",
      body: "Invented scene text.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    expect(await listLinkingRecords(t.db, IDS.project, IDS.dossier)).toEqual([]);
    await linkReference(t.db, IDS.project, IDS.chapter, IDS.dossier);
    await linkReference(t.db, IDS.project, "rec_test_scene_quay", IDS.dossier);
    await linkReference(t.db, IDS.project, IDS.chapter, IDS.world);

    const linking = await listLinkingRecords(t.db, IDS.project, IDS.dossier);
    expect(linking.map((l) => [l.recordId, l.type, l.parentRecordId])).toEqual([
      [IDS.chapter, "manuscript_chapter", null],
      ["rec_test_scene_quay", "manuscript_scene", IDS.chapter],
    ]);
    expect(await listLinkingRecords(t.db, "prj_other", IDS.dossier)).toEqual([]);
  });

  it("lists only open review items for the record", async () => {
    const pkg = makePackage({
      relatedRecords: [
        { recordId: IDS.world, note: "Check the guild entry still matches." },
        { recordId: IDS.outline, note: "Outline mentions the old age." },
      ],
    });
    expect((await applyChangePackage(t.db, pkg, { projectId: IDS.project })).status).toBe("applied");
    const open = await listOpenReviewItemsForRecord(t.db, IDS.project, IDS.world);
    expect(open.map((i) => i.origin).sort()).toEqual(["detected_mention", "package_note"]);
    expect(open.find((i) => i.origin === "package_note")!.note).toBe("Check the guild entry still matches.");

    await resolveReviewItem(t.db, IDS.project, open[0].id);
    expect(await listOpenReviewItemsForRecord(t.db, IDS.project, IDS.world)).toHaveLength(1);
    await resolveReviewItem(t.db, IDS.project, open[1].id);
    expect(await listOpenReviewItemsForRecord(t.db, IDS.project, IDS.world)).toEqual([]);
    expect((await listOpenReviewItemsForRecord(t.db, IDS.project, IDS.outline)).map((i) => i.note)).toContain("Outline mentions the old age.");
  });

  it("lists unapplied assistant proposals for the record without changing anything, and drops them once applied", async () => {
    const before = await snapshotState(t.db);
    const { conv, proposalId } = await propose({
      summary: "Make Mara thirty-four.",
      operations: [
        {
          op: "update_record",
          recordId: IDS.dossier,
          title: null,
          body: "Archivist. Thirty-four years old.",
          setFields: [{ key: "age", valueJson: "34" }],
          unsetFields: [],
          authorityStatus: null,
          note: null,
        },
      ],
      relatedRecords: [],
      fieldTextDisagreements: [],
    });
    expect(await snapshotState(t.db)).toEqual(before);

    const pending = await listPendingProposalsForRecord(t.db, IDS.project, IDS.dossier);
    expect(pending).toEqual([
      expect.objectContaining({ proposalId, conversationId: conv.id, expectedRevision: 1, changes: ["text", "structured fields"] }),
    ]);
    expect(await listPendingProposalsForRecord(t.db, IDS.project, IDS.world)).toEqual([]);

    const row = await t.db.assistantProposal.findUniqueOrThrow({ where: { id: proposalId } });
    const pkg = approvedPackage(JSON.parse(row.packageJson) as ChangePackageV1, row.id, row.contentHash);
    expect((await applyChangePackage(t.db, pkg, { projectId: IDS.project })).status).toBe("applied");
    expect(await listPendingProposalsForRecord(t.db, IDS.project, IDS.dossier)).toEqual([]);
  });

  it("lists the files imported into a record with their original content", async () => {
    const content = "# Harbor charter\n\n| Clause | Text |\n|---|---|\n| 1 | Invented. |\n";
    const outcome = await applyMarkdownImport(t.db, {
      projectId: IDS.project,
      items: [{ filename: "harbor-charter.md", content, title: "Harbor charter", type: "worldbuilding", authorityStatus: "draft", protected: false }],
    });
    if (outcome.status !== "applied") throw new Error("import rejected");
    const recordId = outcome.results[0].recordId!;
    const files = await listImportedFilesForRecord(t.db, IDS.project, recordId);
    expect(files).toEqual([expect.objectContaining({ originalFilename: "harbor-charter.md", content, action: "created", revisionNumber: 1 })]);
    expect(await listImportedFilesForRecord(t.db, IDS.project, IDS.dossier)).toEqual([]);
  });
});
