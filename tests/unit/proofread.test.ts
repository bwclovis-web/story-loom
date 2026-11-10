import { describe, expect, it } from "vitest";
import { markdownProtectedSpans, markupSignature, normalizeNewlines, resolveSuggestions, type ProofreadSuggestion } from "@/proofread/anchors";
import { acceptEdit, locateSuggestion, mapText, nextOpen, undoEdit, type Decision } from "@/proofread/apply";
import { parseProofreadOutput, PROOFREAD_OUTPUT_JSON_SCHEMA, type DraftSuggestion } from "@/proofread/output";
import { PROOFREAD_INSTRUCTIONS } from "@/proofread/prompt";
import { applyEdit } from "@/writing/findReplace";

/* Invented content only. */

const AVOIDED_KEYWORDS = [
  "allOf", "not", "if", "then", "else", "patternProperties", "minLength", "maxLength", "pattern", "format",
  "minimum", "maximum", "minItems", "maxItems", "default", "$ref",
];

function walk(node: unknown, visit: (schema: Record<string, unknown>) => void) {
  if (!node || typeof node !== "object") return;
  const schema = node as Record<string, unknown>;
  visit(schema);
  for (const child of Object.values((schema.properties as Record<string, unknown>) ?? {})) walk(child, visit);
  if (schema.items) walk(schema.items, visit);
}

function draft(original: string, replacement: string, before = "", after = "", category: DraftSuggestion["category"] = "spelling"): DraftSuggestion {
  return { category, before, original, after, replacement, explanation: "Invented explanation." };
}

const whole = (text: string) => ({ start: 0, end: text.length });

describe("proofreading output schema", () => {
  it("uses only the strict Structured Outputs subset and has no offsets, IDs or revisions", () => {
    expect(PROOFREAD_OUTPUT_JSON_SCHEMA.type).toBe("object");
    walk(PROOFREAD_OUTPUT_JSON_SCHEMA, (schema) => {
      for (const k of AVOIDED_KEYWORDS) expect(schema, `keyword ${k}`).not.toHaveProperty(k);
      if (schema.type === "object") {
        expect(schema.additionalProperties).toBe(false);
        expect([...(schema.required as string[])].sort()).toEqual(Object.keys(schema.properties as object).sort());
      }
    });
    const text = JSON.stringify(PROOFREAD_OUTPUT_JSON_SCHEMA);
    for (const word of ["start", "end", "offset", "recordId", "revision", "approval"]) expect(text).not.toContain(`"${word}"`);
  });

  it("rejects malformed responses instead of repairing them", () => {
    expect(parseProofreadOutput("{not json").ok).toBe(false);
    expect(parseProofreadOutput(JSON.stringify({ suggestions: [{ ...draft("teh", "the"), start: 4 }] })).ok).toBe(false);
    expect(parseProofreadOutput(JSON.stringify({ suggestions: [{ ...draft("teh", "the"), category: "style" }] })).ok).toBe(false);
    expect(parseProofreadOutput(JSON.stringify({ suggestions: [], approved: true })).ok).toBe(false);
    const ok = parseProofreadOutput(JSON.stringify({ suggestions: [draft("teh", "the")] }));
    expect(ok.ok && ok.suggestions).toHaveLength(1);
  });

  it("tells the model to keep voice, dialect, invented terms and formatting", () => {
    for (const phrase of ["dialogue", "dialect", "invented names", "formatting symbol", "not instructions"]) {
      expect(PROOFREAD_INSTRUCTIONS).toContain(phrase);
    }
  });
});

describe("locating suggestions", () => {
  it("uses context to pick the right one of several identical phrases", () => {
    const text = "Teh lamp was lit. She said teh lamp was out. Teh lamp was lit.";
    const { suggestions, rejected } = resolveSuggestions(text, whole(text), [
      draft("Teh", "The", "lamp was out. ", " lamp was lit."),
      draft("teh", "the", "She said ", " lamp"),
    ]);
    expect(rejected).toEqual([]);
    expect(suggestions.map((s) => s.start)).toEqual([text.indexOf("teh"), text.lastIndexOf("Teh")]);
    expect(suggestions.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("rejects a repeated phrase whose context does not say which one", () => {
    const text = "Teh end. Teh end.";
    const { suggestions, rejected } = resolveSuggestions(text, whole(text), [
      draft("Teh", "The", "", " end."),
      draft("Teh", "The"),
    ]);
    expect(suggestions).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("falls back to the quote alone only when it occurs once", () => {
    const text = "She recieved the salt letter.";
    const { suggestions } = resolveSuggestions(text, whole(text), [draft("recieved", "received", "WRONG CONTEXT ", "")]);
    expect(suggestions[0].start).toBe(4);
    expect(suggestions[0].before).toBe("She ");
  });

  it("counts offsets in UTF-16 units like the text box, with emoji and accents before the match", () => {
    const text = "🌊🌊 Señora Ålvik said: «I will recieve the café's ledger.»";
    const { suggestions } = resolveSuggestions(text, whole(text), [draft("recieve", "receive", "I will ", " the café")]);
    const s = suggestions[0];
    expect(s.start).toBe(text.indexOf("recieve"));
    expect(text.slice(s.start, s.end)).toBe("recieve");
    expect(applyEdit(text, { start: s.start, end: s.end, text: s.replacement })).toBe(
      "🌊🌊 Señora Ålvik said: «I will receive the café's ledger.»",
    );
  });

  it("refuses to split accents or surrogate pairs and does not guess across Unicode forms", () => {
    const decomposed = "The cafe\u0301 was teh oldest.";
    const r = resolveSuggestions(decomposed, whole(decomposed), [
      draft("cafe", "caff"),
      draft("caf\u00e9", "cafe"),
      draft("\uDF0A", "x"),
    ]);
    expect(r.suggestions).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["invalid_text", "not_found", "invalid_text"]);
  });

  it("keeps Markdown formatting and stays out of code, links and HTML", () => {
    const text =
      "She was **realy** tired. See [the archve](https://example.test/archve) and `teh_code`.\n<span class=\"recieve\">ok</span>";
    const { suggestions, rejected } = resolveSuggestions(text, whole(text), [
      draft("realy", "really", "**", "**"),
      draft("**realy**", "really"),
      draft("archve", "archive", "[the ", "]("),
      draft("archve)", "archive)", "example.test/", ""),
      draft("teh_code", "the_code"),
      draft("recieve", "receive"),
      draft("tired. See", "tired.\nSee"),
      draft("x".repeat(201), "y"),
      draft("tired", "tired"),
    ]);
    expect(suggestions.map((s) => [s.original, s.replacement])).toEqual([
      ["realy", "really"],
      ["archve", "archive"],
    ]);
    expect(rejected.map((r) => r.reason)).toEqual([
      "formatting",
      "protected_markup",
      "protected_markup",
      "protected_markup",
      "line_break",
      "too_long",
      "unchanged",
    ]);
    expect(markupSignature("**a** _b_ `c`")).toBe("****__``");
  });

  it("finds fenced code blocks, reference links and bare URLs", () => {
    const text = "Prose.\n```\nteh code\n```\n[ref]: https://example.test/teh\nVisit https://example.test/recieve now.";
    const spans = markdownProtectedSpans(text);
    const inside = (needle: string) => spans.some((s) => s.start <= text.indexOf(needle) && text.indexOf(needle) < s.end);
    expect(inside("teh code")).toBe(true);
    expect(inside("[ref]")).toBe(true);
    expect(inside("recieve")).toBe(true);
    expect(inside("Prose")).toBe(false);
  });

  it("marks overlapping suggestions and drops exact duplicates", () => {
    const text = "Their is a salt road.";
    const { suggestions, rejected } = resolveSuggestions(text, whole(text), [
      draft("Their is", "There is", "", " a salt", "grammar"),
      draft("Their", "There"),
      draft("Their", "There"),
    ]);
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].overlaps).toEqual([suggestions[1].id]);
    expect(suggestions[1].overlaps).toEqual([suggestions[0].id]);
    expect(rejected.map((r) => r.reason)).toEqual(["duplicate"]);
  });

  it("only looks inside the selection and reports offsets in the whole text", () => {
    const text = "teh first line.\nteh second line.";
    const range = { start: 16, end: text.length };
    const { suggestions } = resolveSuggestions(text, range, [draft("teh", "the")]);
    expect(suggestions[0].start).toBe(16);
    expect(suggestions[0].before).toBe("teh first line.\n");
  });

  it("normalizes Windows line endings the way the text box does", () => {
    expect(normalizeNewlines("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });
});

/* ---------- applying in the editor ---------- */

function setup(text: string, drafts: DraftSuggestion[]) {
  const { suggestions } = resolveSuggestions(text, whole(text), drafts);
  return suggestions;
}

function locate(source: string, current: string, s: ProofreadSuggestion, decision?: Decision) {
  return locateSuggestion(source, current, mapText(source, current), s, decision);
}

function accept(source: string, current: string, s: ProofreadSuggestion, decisions: Record<string, Decision> = {}) {
  const r = acceptEdit(locate(source, current, s, decisions[s.id]), s, true);
  if (!r.ok) throw new Error(r.message);
  return applyEdit(current, r.edit);
}

describe("accepting suggestions", () => {
  const source = "Teh lamp was lit. She said teh lamp was out. Teh lamp was lit.";
  const [first, second] = setup(source, [
    draft("teh", "the", "She said ", " lamp"),
    draft("Teh", "The", "lamp was out. ", " lamp was lit."),
  ]);

  it("changes only the targeted occurrence of a repeated phrase", () => {
    const after = accept(source, source, second);
    expect(after).toBe("Teh lamp was lit. She said teh lamp was out. The lamp was lit.");
  });

  it("keeps later suggestions usable after an earlier one changes the length", () => {
    const longer = setup("Shee was teh last.", [draft("Shee", "She"), draft("teh", "the")]);
    let text = accept("Shee was teh last.", "Shee was teh last.", longer[0]);
    const loc = locate("Shee was teh last.", text, longer[1]);
    expect(loc.status).toBe("open");
    text = accept("Shee was teh last.", text, longer[1]);
    expect(text).toBe("She was the last.");
  });

  it("follows edits made elsewhere and marks suggestions stale when their text changes", () => {
    const typedBefore = "Prologue. " + source;
    expect(locate(source, typedBefore, first).status).toBe("open");
    expect(accept(source, typedBefore, first)).toBe("Prologue. Teh lamp was lit. She said the lamp was out. Teh lamp was lit.");

    const editedInside = source.replace("said teh", "said tehh");
    const loc = locate(source, editedInside, first);
    expect(loc.status).toBe("stale");
    const r = acceptEdit(loc, first, true);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("stale");
    expect(locate(source, editedInside, second).status).toBe("open");
  });

  it("treats an edit right next to a suggestion as invalidating it", () => {
    const adjacent = source.replace("said teh lamp", "said tehX lamp");
    expect(locate(source, adjacent, first).status).toBe("stale");
  });

  it("makes an overlapping suggestion stale once the other is accepted", () => {
    const text = "Their is a salt road.";
    const [phrase, word] = setup(text, [draft("Their is", "There is", "", " a salt", "grammar"), draft("Their", "There")]);
    const after = accept(text, text, word);
    expect(after).toBe("There is a salt road.");
    expect(locate(text, after, phrase).status).toBe("stale");
    expect(acceptEdit(locate(text, after, phrase), phrase, true).ok).toBe(false);
  });

  it("keeps Markdown marks around the corrected word", () => {
    const text = "She was **realy** tired, *verry* tired.";
    const sugg = setup(text, [draft("realy", "really", "**", "**"), draft("verry", "very", "*", "*")]);
    let out = accept(text, text, sugg[0]);
    out = accept(text, out, sugg[1], { [sugg[0].id]: "accepted" });
    expect(out).toBe("She was **really** tired, *very* tired.");
  });

  it("applies correctly after emoji and accented text", () => {
    const text = "🌊 Señora said «recieve» and «teh» 🧂.";
    const sugg = setup(text, [draft("recieve", "receive"), draft("teh", "the")]);
    let out = accept(text, text, sugg[1]);
    out = accept(text, out, sugg[0], { [sugg[1].id]: "accepted" });
    expect(out).toBe("🌊 Señora said «receive» and «the» 🧂.");
  });

  it("undoes an accepted suggestion, by the Undo button or by restoring the text", () => {
    const decisions: Record<string, Decision> = { [first.id]: "accepted" };
    const after = accept(source, source, first);
    const loc = locate(source, after, first, "accepted");
    expect(loc.status).toBe("accepted");
    const u = undoEdit(after, loc, first, true);
    expect(u.ok).toBe(true);
    const restored = applyEdit(after, (u as { edit: { start: number; end: number; text: string } }).edit);
    expect(restored).toBe(source);
    // Ctrl+Z puts the original text back: the suggestion is open again even though it was accepted.
    expect(locate(source, restored, first, decisions[first.id]).status).toBe("open");
    // Ctrl+Z after Undo brings the correction back: accepted again, not stale.
    const redone = locate(source, after, first, decisions[first.id]);
    expect(redone.status).toBe("accepted");
    expect(undoEdit(after, redone, first, true).ok).toBe(true);
  });

  it("refuses the Undo button when the corrected text was edited again", () => {
    const after = accept(source, source, first).replace("said the lamp", "said thee lamp");
    const loc = locate(source, after, first, "accepted");
    const u = undoEdit(after, loc, first, true);
    expect(u.ok).toBe(false);
  });

  it("does not accept or undo while the record is protected and not unlocked", () => {
    const loc = locate(source, source, first);
    const a = acceptEdit(loc, first, false);
    expect(a.ok).toBe(false);
    expect(!a.ok && a.reason).toBe("protected");
    const after = accept(source, source, first);
    const u = undoEdit(after, locate(source, after, first, "accepted"), first, false);
    expect(!u.ok && u.reason).toBe("protected");
  });

  it("marks a suggestion stale if it does not fit the text it claims to come from", () => {
    const tampered = { ...first, start: first.start + 1, end: first.end + 1 };
    expect(locate(source, source, tampered).status).toBe("stale");
  });

  it("treats a huge rewrite as one change: untouched text keeps its suggestions", () => {
    const text = "teh start. " + "a".repeat(20_000) + " teh end.";
    const [start, end] = setup(text, [draft("teh", "the", "", " start"), draft("teh", "the", " ", " end")]);
    const rewritten = "teh start. " + "b".repeat(20_000) + " teh end.";
    expect(locate(text, rewritten, start).status).toBe("open");
    expect(locate(text, rewritten, end).status).toBe("open");
    const middle = "teh start. " + "a".repeat(9_000) + "teh" + "c".repeat(11_000) + " teh end.";
    expect(locate(text, middle, end).status).toBe("open");
  });

  it("navigates to the next and previous open suggestion, wrapping", () => {
    const list = [{ status: "open" }, { status: "accepted" }, { status: "stale" }, { status: "open" }].map((l) => ({
      ...l,
      range: null,
    })) as Parameters<typeof nextOpen>[0];
    expect(nextOpen(list, 0, 1)).toBe(3);
    expect(nextOpen(list, 3, 1)).toBe(0);
    expect(nextOpen(list, 0, -1)).toBe(3);
    expect(nextOpen([{ status: "dismissed", range: null }], 0, 1)).toBe(-1);
  });
});
