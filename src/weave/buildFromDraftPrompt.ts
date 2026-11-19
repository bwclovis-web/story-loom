import type { ProviderMessage } from "@/assistant/prompt";
import { WEAVE_BUILD_OUTPUT_JSON_SCHEMA } from "./buildFromDraftOutput";

export const WEAVE_BUILD_SCHEMA_CHARS = JSON.stringify(WEAVE_BUILD_OUTPUT_JSON_SCHEMA).length;

export const WEAVE_BUILD_INSTRUCTIONS = `You help an author plan a Story Loom Weave plot grid from selected manuscript source text.

Hard rules:
- Propose story threads, concise chapter/scene summaries, optional scene-purpose fields (goal, change, forward consequence), and plot beats only.
- Never write or rewrite manuscript prose for the book. Planning notes only.
- Never invent new chapter or scene record IDs. manuscriptRecordId values must be copied exactly from the SOURCE RECORDS list.
- When a chapter has no separate scenes, summarize at chapter level.
- proposedBoundaries are suggestions for the author to review later. Do not claim the manuscript was split. Prefer an empty list unless a clear boundary is evident.
- Every beat must include sourceExcerpt copied character-for-character from that beat's manuscript record.
- Prefer few durable threads. Keep beat titles short.
- decision may be "" or keep/cut/move/combine/rebuild.
- For Author rewrite plans, base suggestions on the pinned Zero-draft source passages provided; do not invent rewrite prose.`;

export interface WeaveBuildSourceRecord {
  id: string;
  title: string;
  typeLabel: string;
  revisionNumber: number;
  body: string;
}

export function buildWeaveBuildRequest(input: {
  projectTitle: string;
  draftLabel: string;
  viewKindLabel: string;
  records: WeaveBuildSourceRecord[];
}): { instructions: string; input: ProviderMessage[]; totalChars: number } {
  const lines: string[] = [
    `Project: ${input.projectTitle}`,
    `Manuscript draft: ${input.draftLabel}`,
    `Destination Weave view: ${input.viewKindLabel}`,
    "",
    "SOURCE RECORDS (use only these ids):",
  ];
  for (const r of input.records) {
    lines.push("");
    lines.push(`--- ${r.typeLabel}: ${r.title}`);
    lines.push(`id: ${r.id}`);
    lines.push(`revision: ${r.revisionNumber}`);
    lines.push("text:");
    lines.push(r.body);
  }
  const user = lines.join("\n");
  const instructions = WEAVE_BUILD_INSTRUCTIONS;
  return {
    instructions,
    input: [{ role: "user", content: user }],
    totalChars: instructions.length + user.length + WEAVE_BUILD_SCHEMA_CHARS,
  };
}
