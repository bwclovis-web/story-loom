/**
 * Invented series fixture for market-roadmap phases (Story Health, Weave, Write).
 * Uses only fabricated Saltmarsh content. Always seed into createTestDb() files —
 * never the author's working database.
 */
import type { Db } from "@/server/db";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord } from "@/server/services/recordService";

export const ROADMAP_IDS = {
  workspace: "wsp_rm_saltmarsh",
  book1: "prj_rm_book1",
  book2: "prj_rm_book2",
  chapter: "rec_rm_ch01",
  scene: "rec_rm_sc01",
  dossierApproved: "rec_rm_mara",
  dossierDraft: "rec_rm_mira",
  place: "rec_rm_quay",
  decision: "rec_rm_age_open",
  continuityNote: "rec_rm_note_ledger",
} as const;

export const ROADMAP_SERIES = "Saltmarsh Roadmap Annals";

export const ROADMAP_CHAPTER_BODY =
  "Mara Venn checked the dry ledger at dawn. Mira Quill waited on the quay and said nothing about the salt.";

/**
 * Two-book series with manuscript, dossiers, place, open decision, and continuity note.
 * Book 1 holds the manuscript and home references; Book 2 is an empty sibling for series tests.
 */
export async function seedRoadmapSeries(db: Db): Promise<typeof ROADMAP_IDS> {
  await createWorkspace(db, { id: ROADMAP_IDS.workspace, name: "Roadmap workspace" });
  await createProject(db, {
    id: ROADMAP_IDS.book1,
    workspaceId: ROADMAP_IDS.workspace,
    title: "Roadmap Book One",
  });
  await createProject(db, {
    id: ROADMAP_IDS.book2,
    workspaceId: ROADMAP_IDS.workspace,
    title: "Roadmap Book Two",
  });
  await db.project.update({
    where: { id: ROADMAP_IDS.book1 },
    data: { seriesName: ROADMAP_SERIES, bookName: "Book One" },
  });
  await db.project.update({
    where: { id: ROADMAP_IDS.book2 },
    data: { seriesName: ROADMAP_SERIES, bookName: "Book Two" },
  });

  await createRecord(db, ROADMAP_IDS.book1, {
    recordId: ROADMAP_IDS.dossierApproved,
    type: "character_dossier",
    title: "Mara Venn",
    body: "Archivist of the Salt Guild. Thirty years old in Book One.",
    fields: { name: "Mara Venn", aliases: ["Mara"] },
    authorityStatus: "approved",
    worldScope: "series",
  });
  await createRecord(db, ROADMAP_IDS.book1, {
    recordId: ROADMAP_IDS.dossierDraft,
    type: "character_dossier",
    title: "Mira Quill",
    body: "Draft dockside contact. Details unsettled.",
    fields: { name: "Mira Quill" },
    authorityStatus: "draft",
    worldScope: "book",
  });
  await createRecord(db, ROADMAP_IDS.book1, {
    recordId: ROADMAP_IDS.place,
    type: "worldbuilding",
    title: "Saltmarsh Quay",
    body: "Stone pier where ledgers are checked at dawn.",
    fields: { kind: "place" },
    authorityStatus: "approved",
    worldScope: "series",
  });
  await createRecord(db, ROADMAP_IDS.book1, {
    recordId: ROADMAP_IDS.decision,
    type: "canon_decision",
    title: "Mara's age across the series",
    body: "Is Mara still thirty when Book Two opens?",
    authorityStatus: "unresolved",
  });
  await createRecord(db, ROADMAP_IDS.book1, {
    recordId: ROADMAP_IDS.continuityNote,
    type: "continuity_note",
    title: "Ledger cannot be wet before the storm",
    body: "Pending: confirm the quay scene does not contradict the dry-ledger rule.",
    authorityStatus: "unresolved",
  });
  await createRecord(db, ROADMAP_IDS.book1, {
    recordId: ROADMAP_IDS.chapter,
    type: "manuscript_chapter",
    title: "Chapter 1 — Dry Ledger",
    body: ROADMAP_CHAPTER_BODY,
    authorityStatus: "draft",
  });
  await createRecord(db, ROADMAP_IDS.book1, {
    recordId: ROADMAP_IDS.scene,
    type: "manuscript_scene",
    title: "Quay silence",
    body: "Mira Quill watched the tide and kept her questions.",
    authorityStatus: "draft",
    parentRecordId: ROADMAP_IDS.chapter,
  });

  return ROADMAP_IDS;
}
