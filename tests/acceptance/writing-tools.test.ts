import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MutationRejectedError } from "@/server/services/errors";
import { createRecord, getRecord, getRevision, updateRecord } from "@/server/services/recordService";
import { manuscriptWordCounts, sumWordCounts } from "@/server/services/wordCountService";
import { applyEdit, findMatches, invertEdit, replaceAllEdit } from "@/writing/findReplace";
import { countWords } from "@/writing/wordCount";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

const FORMATTED =
  "Ines crossed the **salt** flats at dawn.\n\nShe did not look back. *Salt* stung her eyes.\n\n***\n\nBy noon the salt had won.";

describe("writing tools against stored records", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    await createRecord(t.db, IDS.project, {
      recordId: "rec_test_ch02_prose",
      type: "manuscript_chapter",
      title: "Chapter 2",
      body: FORMATTED,
      authorityStatus: "draft",
    });
  });
  afterEach(() => t.cleanup());

  const replaceAll = (text: string, query: string, replacement: string) =>
    applyEdit(text, replaceAllEdit(text, findMatches(text, query, { matchCase: false }), replacement)!);

  it("keeps formatting through a replacement, save and reload", async () => {
    const edited = replaceAll(FORMATTED, "salt", "ash");
    await updateRecord(t.db, IDS.project, {
      recordId: "rec_test_ch02_prose",
      expectedRevision: 1,
      title: "Chapter 2",
      body: edited,
      fields: {},
      unlockProtected: true,
    });

    const reloaded = await getRecord(t.db, IDS.project, "rec_test_ch02_prose");
    expect(reloaded.currentRevision).toBe(2);
    expect(reloaded.body).toBe(
      "Ines crossed the **ash** flats at dawn.\n\nShe did not look back. *ash* stung her eyes.\n\n***\n\nBy noon the ash had won.",
    );
    expect(countWords(reloaded.body)).toBe(countWords(FORMATTED));
    expect((await getRevision(t.db, "rec_test_ch02_prose", 1))?.body).toBe(FORMATTED);
  });

  it("refuses to save a replacement into a protected chapter without the unlock", async () => {
    const edited = replaceAll(FORMATTED, "salt", "ash");
    const attempt = updateRecord(t.db, IDS.project, {
      recordId: "rec_test_ch02_prose",
      expectedRevision: 1,
      title: "Chapter 2",
      body: edited,
      fields: {},
    });
    await expect(attempt).rejects.toBeInstanceOf(MutationRejectedError);
    await attempt.catch((e: MutationRejectedError) => expect(e.issues.map((i) => i.code)).toContain("PROTECTED_RECORD"));

    const unchanged = await getRecord(t.db, IDS.project, "rec_test_ch02_prose");
    expect(unchanged.body).toBe(FORMATTED);
    expect(unchanged.currentRevision).toBe(1);
  });

  it("restores the original text when a replacement is undone before saving", () => {
    const edit = replaceAllEdit(FORMATTED, findMatches(FORMATTED, "salt", { matchCase: false }), "ash")!;
    const edited = applyEdit(FORMATTED, edit);
    expect(applyEdit(edited, invertEdit(FORMATTED, edit))).toBe(FORMATTED);
  });

  it("totals chapter and book counts from saved text and stays accurate after an edit", async () => {
    const before = await manuscriptWordCounts(t.db, IDS.project);
    expect(before.get("rec_test_ch02_prose")).toBe(countWords(FORMATTED));
    const book = sumWordCounts(before);
    expect(book).toBe(countWords(FORMATTED) + before.get(IDS.chapter)!);
    expect(sumWordCounts(before, "rec_test_ch02_prose")).toBe(before.get(IDS.chapter));

    await updateRecord(t.db, IDS.project, {
      recordId: "rec_test_ch02_prose",
      expectedRevision: 1,
      title: "Chapter 2",
      body: `${FORMATTED}\n\nThree more words.`,
      fields: {},
      unlockProtected: true,
    });
    const after = await manuscriptWordCounts(t.db, IDS.project);
    expect(after.get("rec_test_ch02_prose")).toBe(countWords(FORMATTED) + 3);
    expect(sumWordCounts(after)).toBe(book + 3);
    expect(after.has(IDS.dossier)).toBe(false);
  });
});
