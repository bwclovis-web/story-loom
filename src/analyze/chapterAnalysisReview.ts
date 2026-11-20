import type {
  AnalysisAction,
  AnalysisAssessment,
  AnalysisAssessments,
  AnalysisDecisions,
  AnalysisKind,
  AnalysisSuggestion,
} from "./chapterAnalysisOutput";

export const CATEGORY_BOUNDARY: Record<AnalysisKind, string> = {
  character_presence: "Physical presence in the scene. Being named is not presence, and presence is not knowledge.",
  location: "Where the passage is set. A setting is not an event.",
  event: "Something the text says happened. A plan, intention, or guess is not a completed event.",
  reader_revelation: "What the reader learns here. That is not the event occurring, and it is not a character knowing it.",
  character_learning: "What this one character learns or is told. The reader learning it does not put it in this character's knowledge.",
  plot_beat: "A planning beat. It does not become manuscript canon.",
  reference_evidence: "A possible fact, still pending until you accept it. Dialogue, dreams, and speculation are not established facts.",
  chronology: "An earlier/later link between two events. Chapter order and a blank time label do not supply it.",
};

const ORDER_WORD = /\b(before|after|earlier|later)\b/i;
const MENTION = /\b(mentioned|spoke of|heard of|talked about|named in|rumou?red|letter about)\b/i;
const INTENTION = /\b(planned to|intended to|hoped to|meant to|would one day|if she|if he|going to)\b/i;
const SPECULATION = /\b(maybe|perhaps|what if|might have|could have|i wonder|supposedly)\b/i;

export function quotationMatches(body: string, excerpt: string): { start: number; end: number }[] {
  const needle = excerpt.trim();
  if (!needle) return [];
  const found: { start: number; end: number }[] = [];
  let from = 0;
  while (from < body.length) {
    const start = body.indexOf(needle, from);
    if (start < 0) break;
    found.push({ start, end: start + needle.length });
    from = start + needle.length;
  }
  return found;
}

/** Resolve one quotation. Several matches require a 1-based occurrence. A single match is the only passage. */
export function resolveQuotation(
  body: string,
  excerpt: string,
  occurrence: number,
): { ok: true; start: number; end: number; excerpt: string; matches: number } | { ok: false; reason: string; matches: number } {
  const matches = quotationMatches(body, excerpt);
  if (matches.length === 0) {
    return { ok: false, reason: "This quotation is not in the pinned revision.", matches: 0 };
  }
  if (matches.length === 1) {
    if (occurrence !== 1) {
      return { ok: false, reason: "This quotation occurs once, and the response pointed at another occurrence.", matches: 1 };
    }
    const only = matches[0]!;
    return { ok: true, ...only, excerpt: body.slice(only.start, only.end), matches: 1 };
  }
  if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > matches.length) {
    return {
      ok: false,
      reason: `This quotation appears ${matches.length} times. The response did not identify which one, so it cannot be applied.`,
      matches: matches.length,
    };
  }
  const chosen = matches[occurrence - 1]!;
  return { ok: true, ...chosen, excerpt: body.slice(chosen.start, chosen.end), matches: matches.length };
}

export function passageContext(body: string, start: number, end: number, pad = 80): { before: string; excerpt: string; after: string } {
  return {
    before: body.slice(Math.max(0, start - pad), start),
    excerpt: body.slice(start, end),
    after: body.slice(end, end + pad),
  };
}

/** Null when the quotation names both events and an order word. Otherwise why it is not an order. */
export function chronologyGap(excerpt: string, earlierTitle: string, laterTitle: string): string | null {
  const text = excerpt.toLowerCase();
  const grounded = (title: string) => {
    const name = title.trim().toLowerCase();
    return name.length >= 3 && text.includes(name);
  };
  if (!grounded(earlierTitle) || !grounded(laterTitle)) {
    return "The quotation does not name both events, so it does not establish an order between them.";
  }
  if (!ORDER_WORD.test(excerpt)) {
    return "The quotation does not say that one event is before or after the other.";
  }
  return null;
}

export function interpretationCaution(kind: AnalysisKind, excerpt: string): string | null {
  if (kind === "character_presence" && MENTION.test(excerpt)) {
    return "The quotation looks like a mention. Being named is not physical presence.";
  }
  if (kind === "event" && INTENTION.test(excerpt)) {
    return "The quotation looks like a plan or intention, not an event that has happened.";
  }
  if (kind === "reference_evidence" && (SPECULATION.test(excerpt) || excerpt.includes('"'))) {
    return "Dialogue, speculation, or an unreliable claim is not an established fact.";
  }
  if (kind === "chronology" && ORDER_WORD.test(excerpt) && excerpt.trim().length < 40 && !excerpt.includes(".")) {
    return "An order word by itself does not link two events.";
  }
  return null;
}

const USE_EXISTING = "Link to a record already in your project.";
const EDIT_SUGGESTION = "Change the proposed details before saving. Your manuscript text is not edited.";
const CREATE_REFERENCE = "Create the proposed item when you apply it. New reference records start as draft; new facts start as pending.";
const SKIP_SUGGESTION = "Leave this suggestion out of the changes you apply.";

/** What the selected action writes for this kind. Ratings are not part of this text. */
export function actionExplanation(kind: AnalysisKind, action: Exclude<AnalysisAction, "pending">): string {
  if (action === "skip") return SKIP_SUGGESTION;
  if (action === "edit") return `${EDIT_SUGGESTION} ${editWrite(kind)}`;
  if (action === "reuse") return `${USE_EXISTING} ${reuseWrite(kind)}`;
  return createWrite(kind);
}

function reuseWrite(kind: AnalysisKind): string {
  switch (kind) {
    case "character_presence":
      return "This adds a pending fact that the character appears in the chapter, with this passage as evidence. The dossier text stays as it is.";
    case "location":
      return "This links that place to the chapter. It does not create another place.";
    case "character_learning":
      return "This adds a pending fact about what this character learns, with this passage as evidence. It does not record that anyone else knows it.";
    case "reference_evidence":
      return "This pins the passage to that fact. An accepted fact keeps its statement. Adding evidence is not automatically a duplicate.";
    case "event":
      return "This pins the passage to that story event.";
    case "reader_revelation":
      return "This records that the chapter reveals the event to the reader. It does not make the event happen here, and it does not give a character that knowledge.";
    case "plot_beat":
      return "This keeps that planning beat linked to the chapter. It does not change the chapter.";
    case "chronology":
      return "This records which of the two events is earlier, if that does not contradict an order already stored.";
  }
}

function editWrite(kind: AnalysisKind): string {
  switch (kind) {
    case "character_presence":
    case "location":
      return "A draft dossier or place can be retitled. An approved record is not retitled.";
    case "character_learning":
    case "reference_evidence":
      return "A pending fact’s statement can change. An accepted fact keeps its statement.";
    case "event":
      return "The story event’s title and summary can change, and the passage is pinned.";
    case "plot_beat":
      return "The planning beat’s title and note can change.";
    case "reader_revelation":
      return "The reveal is recorded on the event. It does not give a character that knowledge.";
    case "chronology":
      return "The order between the two events is what gets saved.";
  }
}

function createWrite(kind: AnalysisKind): string {
  switch (kind) {
    case "character_presence":
      return `${CREATE_REFERENCE} This one creates a draft character dossier and a pending fact that they appear in the chapter, with this passage as evidence.`;
    case "location":
      return `${CREATE_REFERENCE} This one creates a draft place and links it to the chapter.`;
    case "character_learning":
      return "Create a pending fact about what this character learns, with this passage as evidence. It does not record that anyone else knows it, and it does not create a reference record or edit the chapter.";
    case "reference_evidence":
      return "Create a pending fact and pin this passage. It is not accepted. This does not create a reference record or edit the chapter.";
    case "event":
      return "Create a story event in this Zero draft and pin this passage. The time stays unknown. This does not create a reference record or edit the chapter.";
    case "reader_revelation":
      return "Record that this chapter reveals the event to the reader. It does not make the event happen here, it does not give a character that knowledge, and it does not create a reference record.";
    case "plot_beat":
      return "Add a planning beat on the Zero-draft grid. It does not change the chapter or create a reference record.";
    case "chronology":
      return "Record that one named event is before the other, if that does not contradict an order already stored. This does not create a reference record or edit the chapter.";
  }
}

export function effectOf(item: AnalysisSuggestion, action: AnalysisAction): string {
  if (action === "pending") return "No choice yet. Nothing will be written for this suggestion.";
  if (action === "skip") return "Skip. Nothing will be written for this suggestion.";
  if (!item.quoteValid) return item.blockedReason || "This suggestion cannot be applied.";
  const name = item.title;
  if (item.kind === "character_presence") {
    return action === "create"
      ? `Create a draft dossier “${name}” and a pending fact that they appear in this chapter, with this passage as evidence.`
      : `Add a pending “appears in this chapter” fact to ${name}, with this passage as evidence. The dossier text stays as it is unless you chose Edit.`;
  }
  if (item.kind === "character_learning") {
    return `Add a pending fact about what ${name} learns, with this passage as evidence. It does not record that anyone else knows it.`;
  }
  if (item.kind === "location") {
    return action === "create"
      ? `Create a draft place “${name}” and link it to this chapter.`
      : `Link the existing place ${name} to this chapter.`;
  }
  if (item.kind === "event") {
    return action === "create"
      ? `Create a story event “${name}” in this Zero draft and pin this passage. The time stays unknown.`
      : `Pin this passage to the existing event ${name}.`;
  }
  if (item.kind === "reader_revelation") return `Record that this chapter reveals “${name}” to the reader. It does not make the event happen here, and it does not give any character that knowledge.`;
  if (item.kind === "plot_beat") return action === "create" ? `Add a planning beat “${name}” on the Zero-draft grid. It does not change the chapter.` : `Keep the existing beat ${name} linked to this chapter.`;
  if (item.kind === "reference_evidence") {
    return action === "create"
      ? `Create a pending fact and pin this passage. It is not accepted, and it is Zero-draft evidence.`
      : `Pin this passage to the existing fact. An accepted fact keeps its statement.`;
  }
  return `Record that “${item.earlierTitle}” is before “${item.laterTitle}”, if that does not contradict an order already stored.`;
}

export interface ApplyWriteSummary {
  records: string[];
  links: string[];
  evidence: string[];
  events: string[];
  beats: string[];
  blocked: string[];
}

export function describeWrites(suggestions: AnalysisSuggestion[], decisions: AnalysisDecisions): ApplyWriteSummary {
  const summary: ApplyWriteSummary = { records: [], links: [], evidence: [], events: [], beats: [], blocked: [] };
  const byKey = new Map(suggestions.map((item) => [item.key, item]));
  for (const item of suggestions) {
    const action = decisions[item.key]?.action ?? "pending";
    if (action === "pending" || action === "skip") continue;
    if (!item.quoteValid) {
      summary.blocked.push(`${item.title}: ${item.blockedReason || "the passage is not verified"}`);
      continue;
    }
    for (const dep of item.dependsOnKeys) {
      const other = byKey.get(dep);
      const depAction = decisions[dep]?.action ?? "pending";
      if (depAction !== "reuse" && depAction !== "edit" && depAction !== "create") {
        summary.blocked.push(`${item.title} depends on “${other?.title ?? dep}”, which is not selected.`);
      }
    }
    const line = effectOf(item, action);
    if (item.kind === "character_presence" || item.kind === "location") {
      if (action === "create") summary.records.push(line);
      else summary.links.push(line);
      if (item.kind === "character_presence") summary.evidence.push(line);
    } else if (item.kind === "character_learning" || item.kind === "reference_evidence") summary.evidence.push(line);
    else if (item.kind === "event" || item.kind === "chronology" || item.kind === "reader_revelation") summary.events.push(line);
    else if (item.kind === "plot_beat") summary.beats.push(line);
    else summary.links.push(line);
  }
  return summary;
}

export interface AnalysisRunSummary {
  byCategory: { kind: AnalysisKind; count: number }[];
  assessments: Record<AnalysisAssessment | "unassessed", number>;
  applied: number;
  skipped: number;
  pending: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimated: boolean } | null;
}

export function summarizeRun(
  suggestions: AnalysisSuggestion[],
  decisions: AnalysisDecisions,
  assessments: AnalysisAssessments,
  appliedKeys: string[],
  usage: AnalysisRunSummary["usage"],
): AnalysisRunSummary {
  const byCategory = (Object.keys(CATEGORY_BOUNDARY) as AnalysisKind[]).map((kind) => ({
    kind,
    count: suggestions.filter((item) => item.kind === kind).length,
  }));
  const assessmentsCount: AnalysisRunSummary["assessments"] = {
    correct: 0,
    needs_editing: 0,
    unsupported: 0,
    duplicate: 0,
    unassessed: 0,
  };
  for (const item of suggestions) {
    const mark = assessments[item.key];
    if (mark) assessmentsCount[mark] += 1;
    else assessmentsCount.unassessed += 1;
  }
  let skipped = 0;
  let pending = 0;
  for (const item of suggestions) {
    const action = decisions[item.key]?.action ?? "pending";
    if (action === "skip") skipped += 1;
    else if (action === "pending") pending += 1;
  }
  return { byCategory, assessments: assessmentsCount, applied: appliedKeys.length, skipped, pending, usage };
}
