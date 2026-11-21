import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDictionaryEntry, dictionaryWordsForProject } from "@/server/services/dictionaryService";
import { createRecord } from "@/server/services/recordService";
import { generateLanguageNames, parseLanguageNamePatternSet } from "@/world/languageNamePatterns";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("World name generator", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("reads patterns from language fields and supports dictionary and dossier actions", async () => {
    await createRecord(t.db, IDS.project, {
      recordId: "rec_test_tongue",
      type: "worldbuilding",
      title: "Salt Cant",
      body: "Harbour traders' speech.",
      fields: {
        kind: "language",
        nameSyllables: "ka\nri\nfen",
        namePatterns: "{S}{s}\n{s}'{s}",
      },
      authorityStatus: "approved",
    });
    const set = parseLanguageNamePatternSet({
      kind: "language",
      nameSyllables: "ka\nri\nfen",
      namePatterns: "{S}{s}",
    });
    expect(set).not.toBeNull();
    const names = generateLanguageNames(set!, { count: 4, seed: "harbour-test" });
    expect(names.length).toBe(4);

    const pick = names[0]!;
    await addDictionaryEntry(
      t.db,
      IDS.project,
      { word: pick, scope: "project", caseSensitive: true, note: "" },
      "manual",
    );
    const words = await dictionaryWordsForProject(t.db, IDS.project);
    expect(words.some((row) => row.word === pick)).toBe(true);

    const dossier = await createRecord(t.db, IDS.project, {
      type: "character_dossier",
      title: names[1]!,
      body: "",
      fields: { name: names[1]! },
      authorityStatus: "draft",
    });
    expect(dossier.outcomes[0]?.recordId).toBeTruthy();
  });
});