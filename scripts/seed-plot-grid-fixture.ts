/**
 * Invented Lantern Archive plot-grid fixture for visual verification.
 * Idempotent on fixed IDs. Never resets the working database.
 */
import { getDb } from "../src/server/db";
import { createProject, createWorkspace } from "../src/server/services/projectService";
import { createRecord } from "../src/server/services/recordService";
import { attachRewriteSource, listManuscriptDrafts, startAuthorRewrite } from "../src/server/services/draftService";
import {
  addWeaveBeat,
  addWeaveSetupPayoff,
  addWeaveThread,
  createWeaveGrid,
  getWeaveGrid,
  listWeaveGrids,
  setWeaveLayoutMode,
  updateWeaveBeat,
} from "../src/server/services/weaveService";

const WS = "wsp_demo";
const BOOK1 = "prj_demo_lantern_archive";
const BOOK2 = "prj_demo_lantern_book2";
const SERIES = "Lantern cycle";

const ZERO_CH = [
  { id: "rec_lantern_z_ch1", title: "Chapter 1: The arrival", scenes: [
    { id: "rec_lantern_z_s01", title: "A new post" },
    { id: "rec_lantern_z_s02", title: "First watch" },
  ]},
  { id: "rec_lantern_z_ch2", title: "Chapter 2: Missing pages", scenes: [
    { id: "rec_lantern_z_s03", title: "An uneasy bargain" },
    { id: "rec_lantern_z_s04", title: "Salt on the tongue" },
  ]},
  { id: "rec_lantern_z_ch3", title: "Chapter 3: The original ledger", scenes: [
    { id: "rec_lantern_z_s05", title: "Names in the margin" },
  ]},
] as const;

async function ensureWorkspace(db: ReturnType<typeof getDb>) {
  const existing = await db.workspace.findFirst({ where: { id: WS } });
  if (!existing) await createWorkspace(db, { id: WS, name: "Demo workspace" });
}

async function ensureBook(
  db: ReturnType<typeof getDb>,
  id: string,
  title: string,
  bookName: string,
) {
  const existing = await db.project.findFirst({ where: { id } });
  if (!existing) {
    await createProject(db, { id, workspaceId: WS, title });
  }
  await db.project.update({
    where: { id },
    data: { seriesName: SERIES, bookName, title },
  });
}

async function ensureZeroTree(db: ReturnType<typeof getDb>) {
  const drafts = await listManuscriptDrafts(db, BOOK1);
  let zero = drafts.find((d) => d.kind === "zero_draft");
  if (!zero) {
    // Promote by creating manuscript then startAuthorRewrite's ensureZeroDraft path via first chapter without draft.
    // Create a zero draft row directly then attach records.
    const id = "drf_lantern_zero";
    await db.manuscriptDraft.create({
      data: { id, projectId: BOOK1, kind: "zero_draft", label: "Zero draft" },
    });
    zero = { id, projectId: BOOK1, kind: "zero_draft", label: "Zero draft", completedAt: null, createdAt: new Date() };
  }

  let pos = 0;
  for (const ch of ZERO_CH) {
    const have = await db.record.findFirst({ where: { id: ch.id } });
    if (!have) {
      await createRecord(db, BOOK1, {
        recordId: ch.id,
        type: "manuscript_chapter",
        title: ch.title,
        body: `Zero draft prose for ${ch.title}.`,
        authorityStatus: "draft",
        draftId: zero.id,
      });
    } else {
      await db.record.update({ where: { id: ch.id }, data: { draftId: zero.id, title: ch.title } });
    }
    await db.record.update({ where: { id: ch.id }, data: { position: pos++ } });
    for (const sc of ch.scenes) {
      const haveSc = await db.record.findFirst({ where: { id: sc.id } });
      if (!haveSc) {
        await createRecord(db, BOOK1, {
          recordId: sc.id,
          type: "manuscript_scene",
          title: sc.title,
          body: `Zero draft scene: ${sc.title}.`,
          authorityStatus: "draft",
          parentRecordId: ch.id,
          draftId: zero.id,
        });
      } else {
        await db.record.update({
          where: { id: sc.id },
          data: { draftId: zero.id, parentRecordId: ch.id, title: sc.title },
        });
      }
      await db.record.update({ where: { id: sc.id }, data: { position: pos++ } });
    }
  }
  return zero.id;
}

async function ensureAuthor(db: ReturnType<typeof getDb>) {
  const result = await startAuthorRewrite(db, BOOK1);
  return result.authorDraft.id;
}

async function mapAuthorScenes(db: ReturnType<typeof getDb>, authorDraftId: string) {
  const authorScenes = await db.record.findMany({
    where: { projectId: BOOK1, draftId: authorDraftId, type: "manuscript_scene", trashedAt: null },
    select: { id: true, title: true },
  });
  const byTitle = new Map(authorScenes.map((s) => [s.title, s.id]));
  return {
    s01: byTitle.get("A new post")!,
    s02: byTitle.get("First watch")!,
    s03: byTitle.get("An uneasy bargain")!,
    s04: byTitle.get("Salt on the tongue")!,
    s05: byTitle.get("Names in the margin")!,
  };
}

async function ensureExtraPin(
  db: ReturnType<typeof getDb>,
  fromSceneId: string,
  toSceneId: string,
) {
  const existing = await db.rewriteSourceLink.findFirst({
    where: { projectId: BOOK1, fromRecordId: fromSceneId, toRecordId: toSceneId },
  });
  if (existing) return;
  const to = await db.record.findFirst({
    where: { id: toSceneId },
    select: { currentRevision: true },
  });
  if (!to) return;
  await attachRewriteSource(db, BOOK1, fromSceneId, toSceneId, to.currentRevision);
}

async function ensureGrid(db: ReturnType<typeof getDb>, scenes: Record<string, string>) {
  const grids = await listWeaveGrids(db, BOOK1);
  const existingSummary = grids.find((g) => g.title === "Author rewrite plan");
  const created = existingSummary
    ? null
    : await createWeaveGrid(db, BOOK1, {
        title: "Author rewrite plan",
        viewKind: "author_rewrite",
      });
  const gridId = existingSummary?.id ?? created!.id;
  await setWeaveLayoutMode(db, BOOK1, gridId, "plot_grid");

  const full = await getWeaveGrid(db, BOOK1, gridId);
  const threadTitles = ["Main mystery", "Character arc", "Relationship"] as const;
  const threads: string[] = [];
  for (const title of threadTitles) {
    const existing = full.threads.find((t) => t.title === title);
    if (existing) threads.push(existing.id);
    else threads.push((await addWeaveThread(db, BOOK1, gridId, { title })).id);
  }
  const [main, arc, rel] = threads as [string, string, string];

  const desired = [
    { key: "beat_page", title: "A page is missing", body: "Rebuild — tighten the hook.", decision: "rebuild", threadId: main, ms: scenes.s01, order: 0 },
    { key: "beat_trust", title: "Trust has a price", body: "Elian weighs the oath.", decision: "keep", threadId: arc, ms: scenes.s01, order: 0 },
    { key: "beat_clue", title: "A clue changes hands", body: "The clue changes what Elian believes about the missing page.", decision: "keep", threadId: main, ms: scenes.s03, order: 0 },
    { key: "beat_second", title: "Second watch falters", body: "Same cell as the hook.", decision: "move", threadId: main, ms: scenes.s01, order: 1 },
    { key: "beat_salt", title: "Salt on the tongue", body: "Payoff seed.", decision: "keep", threadId: rel, ms: scenes.s04, order: 0 },
    { key: "beat_margin", title: "Names in the margin", body: "Later book plant.", decision: "keep", threadId: main, ms: scenes.s05, order: 0 },
    { key: "beat_unplaced_a", title: "Dockside rumor", body: "Unplaced.", decision: "", threadId: null as string | null, ms: null as string | null, order: 0 },
    { key: "beat_unplaced_b", title: "False tide", body: "Cut path.", decision: "cut", threadId: null, ms: null, order: 0 },
    { key: "beat_unplaced_c", title: "Ledger dust", body: "Hold.", decision: "keep", threadId: arc, ms: null, order: 0 },
  ];

  const byTitle = new Map((await getWeaveGrid(db, BOOK1, gridId)).beats.map((b) => [b.title, b]));
  const ids: Record<string, string> = {};
  for (const d of desired) {
    let beat = byTitle.get(d.title);
    if (!beat) {
      beat = await addWeaveBeat(db, BOOK1, gridId, {
        title: d.title,
        body: d.body,
        x: 40,
        y: 40,
        threadId: d.threadId,
        manuscriptRecordId: d.ms,
        cellOrder: d.order,
        decision: d.decision,
      });
    } else {
      beat = await updateWeaveBeat(db, BOOK1, gridId, beat.id, {
        title: d.title,
        body: d.body,
        decision: d.decision,
        threadId: d.threadId,
        manuscriptRecordId: d.ms,
        cellOrder: d.order,
      });
    }
    ids[d.key] = beat.id;
  }

  const links = await getWeaveGrid(db, BOOK1, gridId);
  const hasLink = links.setupPayoffs.some(
    (l) => l.fromBeatId === ids.beat_page && l.toBeatId === ids.beat_clue,
  );
  if (!hasLink) {
    await addWeaveSetupPayoff(db, BOOK1, {
      fromBeatId: ids.beat_page!,
      toBeatId: ids.beat_clue!,
      note: "Hook to bargain",
    });
  }

  // Extra pin so Compare shows a source chooser on the bargain scene.
  await ensureExtraPin(db, scenes.s03, "rec_lantern_z_s01");
  await ensureExtraPin(db, scenes.s03, "rec_lantern_z_s03");

  return gridId;
}

async function ensureBook2Stub(db: ReturnType<typeof getDb>) {
  const have = await db.record.findFirst({
    where: { projectId: BOOK2, type: "manuscript_chapter", trashedAt: null },
  });
  if (have) return;
  await createRecord(db, BOOK2, {
    recordId: "rec_lantern_b2_ch1",
    type: "manuscript_chapter",
    title: "Chapter 1: Far quay",
    body: "Book 2 stub for series book switching.",
    authorityStatus: "draft",
  });
  await createWeaveGrid(db, BOOK2, { title: "Book 2 map", viewKind: "original" });
}

async function main() {
  const db = getDb();
  await ensureWorkspace(db);
  await ensureBook(db, BOOK1, "The Lantern Archive", "Book 1");
  await ensureBook(db, BOOK2, "The Lantern Archive · Book 2", "Book 2");
  await ensureBook2Stub(db);
  await ensureZeroTree(db);
  const authorDraftId = await ensureAuthor(db);
  const scenes = await mapAuthorScenes(db, authorDraftId);
  const gridId = await ensureGrid(db, scenes);
  console.log(JSON.stringify({ projectId: BOOK1, gridId, book2: BOOK2, scenes }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
