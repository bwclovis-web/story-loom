import type { ProviderMessage } from "@/assistant/prompt";
import { CHAPTER_ANALYSIS_OUTPUT_JSON_SCHEMA } from "./chapterAnalysisOutput";

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
- chronology is allowed only when the excerpt explicitly orders two events (it says one is before or after the other). Set explicitOrder true and fill earlierTitle and laterTitle with the event titles. If the order is not explicit, do not emit a chronology suggestion.
- If you are not sure, set uncertain true and explain why in uncertainty. Do not hide a guess as a fact.
- Prefer matching names to the CATALOG titles. Do not invent a second record when the catalog already has that name.
- title is the character, place, event, beat, or fact statement. note is the interpretation.
- For suggestions that are not chronology, set explicitOrder false and leave earlierTitle and laterTitle empty.`;

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
}): { instructions: string; input: ProviderMessage[]; userText: string; totalChars: number } {
  const lines = [
    `Project: ${input.projectTitle}`,
    `Draft: ${input.draftLabel}`,
    `Chapter id: ${input.chapterId}`,
    `Chapter title: ${input.chapterTitle}`,
    `Pinned revision: ${input.revision}`,
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
