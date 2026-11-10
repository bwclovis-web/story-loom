import { describe, expect, it } from "vitest";
import { acceptedSpellingsText, buildProofreadRequest } from "@/proofread/prompt";
import {
  changesDictionaryWord,
  defaultCaseSensitive,
  DictionaryMatcher,
  dictionaryWordsIn,
  editDistance,
  findDuplicate,
  findMisspellings,
  similarDictionaryWords,
  validateDictionaryWord,
  type DictionaryWord,
} from "@/spelling/dictionary";
import {
  buildDictionaryExport,
  classifyImport,
  MAX_IMPORT_WORDS,
  parseDictionaryImport,
} from "@/spelling/dictionaryFile";
import { mapRanges } from "@/spelling/ranges";
import { createWordChecker, spellTokens } from "@/spelling/words";
import { standardWordChecker } from "@/server/spellDictionaries";
import { parseSpellChecker } from "@/writing/spelling";

/* Invented names and words only. */

const words = (text: string) => spellTokens(text).map((t) => t.word);
const isKnown = standardWordChecker("en-US");

describe("spelling tokens", () => {
  it("finds words with inner apostrophes and splits hyphenated words", () => {
    expect(words("Aldreth’s well-known cloak didn't fit.")).toEqual(["Aldreth’s", "well", "known", "cloak", "didn't", "fit"]);
  });

  it("skips code, links, URLs, HTML, single letters and words joined to digits", () => {
    const text = "Vexmoor `qzxv` [the archive](https://example.test/qzxv) <span class=\"zzq\">ok</span> a b2 3rd foo_bar &amp; Korrigane";
    expect(words(text)).toEqual(["Vexmoor", "the", "archive", "ok", "Korrigane"]);
  });

  it("gives offsets in the text as typed", () => {
    const text = "🌊 Orvanne\nsaid";
    const [first] = spellTokens(text);
    expect(text.slice(first.start, first.end)).toBe("Orvanne");
  });
});

describe("standard dictionary", () => {
  it("accepts ordinary English, curly apostrophes and accented spellings", () => {
    for (const w of ["harbor", "the", "don’t", "café", "Wednesday"]) expect(isKnown(w), w).toBe(true);
    expect(isKnown("harbour")).toBe(false);
    expect(standardWordChecker("en-GB")("harbour")).toBe(true);
  });

  it("does not know invented names", () => {
    for (const w of ["Aldreth", "Vexmoor", "Korrigane", "glimmerfrost"]) expect(isKnown(w), w).toBe(false);
  });

  it("caches results", () => {
    let calls = 0;
    const check = createWordChecker({ check: () => (calls++, true) });
    check("Orvanne");
    check("Orvanne");
    expect(calls).toBe(1);
  });
});

describe("dictionary matching", () => {
  const entries: DictionaryWord[] = [
    { word: "Aldreth", caseSensitive: true },
    { word: "glimmerfrost", caseSensitive: false },
  ];
  const matcher = new DictionaryMatcher(entries);

  it("matches case-sensitive entries exactly, including possessives", () => {
    for (const w of ["Aldreth", "Aldreth's", "Aldreth’s"]) expect(matcher.accepts(w), w).toBe(true);
    for (const w of ["aldreth", "ALDRETH", "AldrethS"]) expect(matcher.accepts(w), w).toBe(false);
  });

  it("matches other entries in any capitals", () => {
    for (const w of ["glimmerfrost", "Glimmerfrost", "GLIMMERFROST"]) expect(matcher.accepts(w), w).toBe(true);
  });

  it("stops flags only for entries: a similar name is still flagged", () => {
    const text = "Aldreth met Aldrith in the glimmerfrost. aldreth waved.";
    const flagged = findMisspellings(text, isKnown, matcher).map((f) => f.word);
    expect(flagged).toEqual(["Aldrith", "aldreth"]);
    expect(similarDictionaryWords("Aldrith", entries)).toEqual(["Aldreth"]);
    expect(similarDictionaryWords("aldreth", entries)).toEqual(["Aldreth"]);
    expect(similarDictionaryWords("Aldreth", entries)).toEqual([]);
    expect(similarDictionaryWords("Vexmoor", entries)).toEqual([]);
  });

  it("measures edits with swapped letters as one", () => {
    expect(editDistance("aldreth", "aldrteh")).toBe(1);
    expect(editDistance("aldreth", "aldrith")).toBe(1);
    expect(editDistance("aldreth", "vexmoor")).toBe(3);
  });

  it("defaults to matching case only for words with capitals", () => {
    expect(defaultCaseSensitive("Korrigane")).toBe(true);
    expect(defaultCaseSensitive("glimmerfrost")).toBe(false);
  });
});

describe("dictionary entries", () => {
  it("accepts one word as the checker sees it", () => {
    expect(validateDictionaryWord("  Aldreth’s ")).toEqual({ ok: true, word: "Aldreth's" });
    for (const bad of ["", "Aldreth Vexmoor", "well-known", "R2D2", "x", "a".repeat(65), "Vex!"]) {
      expect(validateDictionaryWord(bad).ok, bad).toBe(false);
    }
  });

  it("treats two capitalisations as different only when both match case", () => {
    const existing = [{ word: "Aldreth", caseSensitive: true }];
    expect(findDuplicate(existing, { word: "Aldreth", caseSensitive: true })).not.toBeNull();
    expect(findDuplicate(existing, { word: "ALDRETH", caseSensitive: true })).toBeNull();
    expect(findDuplicate(existing, { word: "aldreth", caseSensitive: false })).not.toBeNull();
  });
});

describe("dictionary import and export", () => {
  it("round-trips an export", () => {
    const file = buildDictionaryExport(
      "workspace",
      "Invented series",
      [
        { word: "Vexmoor", caseSensitive: true, note: "the marsh city" },
        { word: "glimmerfrost", caseSensitive: false, note: "" },
      ],
      new Date("2026-01-02T03:04:05Z"),
    );
    const parsed = parseDictionaryImport(JSON.stringify(file));
    expect(parsed.ok && parsed.kind).toBe("wordly");
    if (!parsed.ok) return;
    expect(parsed.candidates.map((c) => [c.word, c.caseSensitive, c.note, c.status])).toEqual([
      ["glimmerfrost", false, "", "new"],
      ["Vexmoor", true, "the marsh city", "new"],
    ]);
  });

  it("reads word lists and Hunspell .dic files", () => {
    const parsed = parseDictionaryImport("\uFEFF3\n# invented\nKorrigane/M\nglimmerfrost\n\nnot one word\n");
    expect(parsed.ok && parsed.kind).toBe("word list");
    if (!parsed.ok) return;
    expect(parsed.candidates.map((c) => [c.word, c.caseSensitive, c.status, c.position])).toEqual([
      ["Korrigane", true, "new", 3],
      ["glimmerfrost", false, "new", 4],
      ["not one word", false, "invalid", 6],
    ]);
  });

  it("rejects malformed or oversized files", () => {
    expect(parseDictionaryImport("").ok).toBe(false);
    expect(parseDictionaryImport('{"format":"something.else"}').ok).toBe(false);
    expect(parseDictionaryImport("{not json").ok).toBe(false);
    expect(parseDictionaryImport(Array.from({ length: MAX_IMPORT_WORDS + 1 }, (_, i) => `qa${"z".repeat(i % 50)}`).join("\n")).ok).toBe(false);
  });

  it("marks words already accepted, or repeated, as duplicates", () => {
    // "VEXMOOR" and "Vexmoor" both match case, so both can be kept; plain "vexmoor" would accept either.
    const parsed = parseDictionaryImport("Aldreth\nVexmoor\nVEXMOOR\nvexmoor\nOrvanne\n");
    if (!parsed.ok) throw new Error(parsed.message);
    const rows = classifyImport(parsed.candidates, [{ word: "Aldreth", caseSensitive: true }]);
    expect(rows.map((r) => r.status)).toEqual(["duplicate", "new", "new", "duplicate", "new"]);
    expect(rows[0].message).toContain("Already in your dictionary");
    expect(rows[3].message).toContain("earlier in the file");
  });
});

describe("keeping flags in place while typing", () => {
  const text = "Aldrith rode to Vexmor at dawn.";
  const flags = spellTokens(text).filter((t) => ["Aldrith", "Vexmor"].includes(t.word));

  it("moves flags after an edit elsewhere and drops flags on edited words", () => {
    const inserted = text.replace("rode", "rode slowly");
    expect(mapRanges(text, inserted, flags).map((f) => inserted.slice(f.start, f.end))).toEqual(["Aldrith", "Vexmor"]);
    // Typing right next to a flagged word may be changing it, so its flag waits for the next check.
    expect(mapRanges(text, "Sir " + text, flags).map((f) => f.word)).toEqual(["Vexmor"]);
    const fixed = text.replace("Vexmor", "Vexmoor");
    expect(mapRanges(text, fixed, flags).map((f) => fixed.slice(f.start, f.end))).toEqual(["Aldrith"]);
    const appended = text.replace("Aldrith", "Aldrithe");
    expect(mapRanges(text, appended, flags).map((f) => f.word)).toEqual(["Vexmor"]);
  });
});

describe("dictionary words in proofreading", () => {
  const entries: DictionaryWord[] = [
    { word: "Aldreth", caseSensitive: true },
    { word: "glimmerfrost", caseSensitive: false },
    { word: "Korrigane", caseSensitive: true },
  ];

  it("lists only the entries that occur in the text", () => {
    expect(dictionaryWordsIn("Aldreth’s GLIMMERFROST was gone. aldreth?", entries)).toEqual(entries.slice(0, 2));
    expect(dictionaryWordsIn("korrigane", entries)).toEqual([]);
  });

  it("puts them in the request as accepted spellings", () => {
    const text = acceptedSpellingsText(entries.slice(0, 2));
    expect(text).toBe('Accepted spellings from the author\'s dictionary: "Aldreth" (match case), "glimmerfrost"\n\n');
    const src = {
      recordId: "rec_invented",
      title: "Invented chapter",
      type: "manuscript_chapter" as const,
      revision: 1,
      scope: "document" as const,
      range: { start: 0, end: 7 },
      text: "Aldreth",
    };
    const request = buildProofreadRequest(src, "BOUNDARY", 100, entries.slice(0, 1));
    expect(request.input[0].content).toContain('"Aldreth" (match case)');
    expect(request.items.map((i) => i.label)).toContain("Dictionary words found in the text (1)");
    expect(buildProofreadRequest(src, "BOUNDARY", 100).input[0].content).not.toContain("Accepted spellings");
  });

  it("recognises corrections that would change a dictionary word", () => {
    const matcher = new DictionaryMatcher(entries);
    expect(changesDictionaryWord("Aldreth sayd", "Aldreth said", matcher)).toBe(false);
    expect(changesDictionaryWord("Aldreth", "Aldrith", matcher)).toBe(true);
    expect(changesDictionaryWord("Aldreth's cloak", "the cloak", matcher)).toBe(true);
    expect(changesDictionaryWord("Aldrith", "Aldreth", matcher)).toBe(false);
  });
});

describe("spell checker preference", () => {
  it("defaults to the app's checker", () => {
    expect(parseSpellChecker(undefined)).toBe("app");
    expect(parseSpellChecker("browser")).toBe("browser");
    expect(parseSpellChecker("other")).toBe("app");
  });
});

describe("performance with a long invented chapter", () => {
  const paragraph =
    "Aldreth crossed the glimmerfrost toward Vexmoor while Korrigane watched from the harbor wall. " +
    "The tide was late again, and the archivists counted every ledger twice before dawn. ";
  const chapter = paragraph.repeat(1_200); // about 33,000 words
  const matcher = new DictionaryMatcher([
    { word: "Aldreth", caseSensitive: true },
    { word: "glimmerfrost", caseSensitive: false },
  ]);

  it("checks a whole chapter quickly", () => {
    const started = performance.now();
    const flags = findMisspellings(chapter, isKnown, matcher);
    const ms = performance.now() - started;
    expect(flags.length).toBe(2_400);
    expect(new Set(flags.map((f) => f.word))).toEqual(new Set(["Vexmoor", "Korrigane"]));
    expect(ms).toBeLessThan(1_500);
  });

  it("moves flags on each keystroke without noticeable delay", () => {
    const flags = findMisspellings(chapter, isKnown, matcher);
    let text = chapter;
    const started = performance.now();
    for (let i = 0; i < 50; i++) {
      const at = Math.floor(text.length / 2);
      const next = text.slice(0, at) + "x" + text.slice(at);
      mapRanges(text, next, flags);
      text = next;
    }
    expect((performance.now() - started) / 50).toBeLessThan(20);
  });
});
