import type { ProviderMessage } from "@/assistant/prompt";
import { ANALYSIS_KINDS, CHAPTER_ANALYSIS_OUTPUT_JSON_SCHEMA, type AnalysisKind } from "./chapterAnalysisOutput";
import { CATEGORY_BOUNDARY } from "./chapterAnalysisReview";

export const CHAPTER_ANALYSIS_SCHEMA_CHARS = JSON.stringify(CHAPTER_ANALYSIS_OUTPUT_JSON_SCHEMA).length;

export const CHAPTER_ANALYSIS_INSTRUCTIONS = `You analyze one pinned Zero-draft chapter for Story Loom. You propose suggestions. You do not rewrite the chapter.

Hard rules:
- Every suggestion's excerpt must be copied character-for-character from the chapter text. Do not paraphrase the quote.
- character_presence means a character is in the passage. It does not mean they know anything.
- location means where the passage is set. A setting is not an event.
- event means something that occurs, or that the text says occurred. Leave the story time unknown unless the excerpt itself gives a time phrase, and put that phrase in the note.
- reader_revelation means the reader learns an event in this passage. It does not mean the event happens in this passage, and it does not mean every character knows it.
- character_learning means the text shows one character learning or being told something. Name that character in title. This is not reader revelation.
- plot_beat is a planning beat, not manuscript canon.
- reference_evidence is a claim that could be an established fact, supported by the excerpt.
- chronology is allowed only when the excerpt itself orders two named events (both names are in the quotation, and it says one is before or after the other). Set explicitOrder true, set occurrence, and fill earlierTitle and laterTitle with those event titles. "Later, she understood" does not order two events. Do not use chapter order, the order the reader learns things, or a blank time.
- occurrence is which copy of the quotation you mean, starting at 1. If the same words appear twice, count the copies and set occurrence to the one you mean. Never leave it ambiguous.
- A character being mentioned, spoken of, or named in a letter is not character_presence.
- character_presence is not character_learning. reader_revelation is not character_learning and is not the event occurring.
- A plan, intention, dream, or hypothetical is not an event that has happened.
- Dialogue, speculation, and unreliable claims are not reference_evidence for an established fact.
- plot_beat is planning only.
- If you are not sure, set uncertain true and explain why in uncertainty. Do not hide a guess as a fact. There is no confidence score.
- Prefer matching names to the CATALOG titles. Do not invent a second record when the catalog already has that name.
- title is the character, place, event, beat, or fact statement. note is the interpretation.
- For suggestions that are not chronology, set explicitOrder false and leave earlierTitle and laterTitle empty.
- Propose only the categories named in the user message.`;

export interface AnalysisCatalogItem {
  id: string;
  title: string;
  detail?: string;
}

export function buildChapterAnalysisRequest(input: {
  projectTitle: string;
  draftLabel: string;
  chapterId: string;
  chapterTitle: string;
  revision: number;
  body: string;
  characters: AnalysisCatalogItem[];
  places: AnalysisCatalogItem[];
  facts: AnalysisCatalogItem[];
  events: AnalysisCatalogItem[];
  beats: AnalysisCatalogItem[];
  categories: readonly AnalysisKind[];
}): { instructions: string; input: ProviderMessage[]; userText: string; totalChars: number } {
  const categories = input.categories.length ? input.categories : [...ANALYSIS_KINDS];
  const lines = [
    `Project: ${input.projectTitle}`,
    `Draft: ${input.draftLabel}`,
    `Chapter id: ${input.chapterId}`,
    `Chapter title: ${input.chapterTitle}`,
    `Pinned revision: ${input.revision}`,
    "",
    "CATEGORIES TO PROPOSE",
    ...categories.map((kind) => `- ${kind}: ${CATEGORY_BOUNDARY[kind]}`),
    "",
    "CATALOG — characters",
    ...input.characters.map((item) => `- ${item.id}: ${item.title}`),
    "CATALOG — places",
    ...input.places.map((item) => `- ${item.id}: ${item.title}`),
    "CATALOG — accepted facts (evidence count in parentheses)",
    ...input.facts.map((item) => `- ${item.id}: ${item.title}${item.detail ? ` (${item.detail})` : ""}`),
    "CATALOG — story events",
    ...input.events.map((item) => `- ${item.id}: ${item.title}${item.detail ? ` [${item.detail}]` : ""}`),
    "CATALOG — plot beats already linked to this chapter",
    ...input.beats.map((item) => `- ${item.id}: ${item.title}`),
    "",
    "CHAPTER TEXT:",
    input.body,
  ];
  const userText = lines.join("\n");
  return {
    instructions: CHAPTER_ANALYSIS_INSTRUCTIONS,
    input: [{ role: "user", content: userText }],
    userText,
    totalChars: CHAPTER_ANALYSIS_INSTRUCTIONS.length + userText.length + CHAPTER_ANALYSIS_SCHEMA_CHARS,
  };
}
