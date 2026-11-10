import { diffChars } from "diff";
import type { TextEdit } from "@/writing/findReplace";
import type { ProofreadSuggestion } from "./anchors";

/*
 * Applying proofreading suggestions in the editor. Suggestions are located
 * on the text that was proofread (the source). The text box may have changed
 * since: accepted suggestions, typing, find and replace, undo. A character
 * diff from source to current text tells where each suggestion is now.
 *
 * A suggestion stays usable only while its characters, and the characters
 * right next to it, are unchanged. Otherwise it is stale and cannot be
 * accepted. Nothing here touches the text box; callers apply the returned
 * edit as one undoable step.
 */

interface Segment {
  srcStart: number;
  srcEnd: number;
  curStart: number;
  curEnd: number;
  equal: boolean;
}

export interface TextMap {
  segments: Segment[];
}

/** Above this many changed characters the diff gives up and the changed middle counts as one change. */
const MAX_EDIT_LENGTH = 5_000;

export function mapText(source: string, current: string): TextMap {
  if (source === current) {
    return { segments: [{ srcStart: 0, srcEnd: source.length, curStart: 0, curEnd: current.length, equal: true }] };
  }
  const limit = Math.min(source.length, current.length);
  let prefix = 0;
  while (prefix < limit && source[prefix] === current[prefix]) prefix++;
  let suffix = 0;
  while (suffix < limit - prefix && source[source.length - 1 - suffix] === current[current.length - 1 - suffix]) suffix++;

  const srcMid = source.slice(prefix, source.length - suffix);
  const curMid = current.slice(prefix, current.length - suffix);
  const segments: Segment[] = [];
  const push = (srcLen: number, curLen: number, equal: boolean) => {
    if (srcLen === 0 && curLen === 0) return;
    const last = segments[segments.length - 1];
    const srcStart = last ? last.srcEnd : 0;
    const curStart = last ? last.curEnd : 0;
    if (last && last.equal === equal) {
      last.srcEnd += srcLen;
      last.curEnd += curLen;
    } else segments.push({ srcStart, srcEnd: srcStart + srcLen, curStart, curEnd: curStart + curLen, equal });
  };

  push(prefix, prefix, true);
  const parts = diffChars(srcMid, curMid, { maxEditLength: MAX_EDIT_LENGTH, timeout: 500 });
  if (!parts) push(srcMid.length, curMid.length, false);
  else {
    for (const p of parts) {
      if (p.added) push(0, p.value.length, false);
      else if (p.removed) push(p.value.length, 0, false);
      else push(p.value.length, p.value.length, true);
    }
  }
  push(suffix, suffix, true);
  return { segments };
}

/** Where source [start, end) is now, if nothing inside it or directly next to it changed. */
export function mapUntouched(map: TextMap, start: number, end: number): { start: number; end: number } | null {
  const { segments } = map;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.equal || start < seg.srcStart || end > seg.srcEnd) continue;
    if (start === seg.srcStart && i > 0) return null;
    if (end === seg.srcEnd && i < segments.length - 1) return null;
    return { start: seg.curStart + (start - seg.srcStart), end: seg.curStart + (end - seg.srcStart) };
  }
  return null;
}

/**
 * Where a source position is now, if it sits in unchanged text (or at its
 * edge). Text inserted exactly at the position counts as after it for "left"
 * and before it for "right", so a range mapped left-to-right includes it.
 */
export function mapBoundary(map: TextMap, position: number, bias: "left" | "right"): number | null {
  const segs = bias === "left" ? map.segments : [...map.segments].reverse();
  for (const seg of segs) {
    if (seg.equal && position >= seg.srcStart && position <= seg.srcEnd) return seg.curStart + (position - seg.srcStart);
  }
  return null;
}

export type Decision = "accepted" | "dismissed";
export type SuggestionStatus = "open" | "accepted" | "dismissed" | "stale";

export interface LocatedSuggestion {
  status: SuggestionStatus;
  /** Current range of the original text (open, or dismissed but still in place), or of the replacement (accepted). */
  range: { start: number; end: number } | null;
}

/** A suggestion is only trusted if it matches the text it was made for. */
function fitsSource(source: string, s: ProofreadSuggestion): boolean {
  return (
    source.slice(s.start, s.end) === s.original &&
    source.slice(Math.max(0, s.start - s.before.length), s.start) === s.before &&
    source.slice(s.end, s.end + s.after.length) === s.after
  );
}

export function locateSuggestion(
  source: string,
  current: string,
  map: TextMap,
  s: ProofreadSuggestion,
  decision: Decision | undefined,
): LocatedSuggestion {
  if (!fitsSource(source, s)) return { status: "stale", range: null };
  const at = mapUntouched(map, s.start, s.end);
  if (at && current.slice(at.start, at.end) === s.original) {
    // Accepted but back in its original form means the acceptance was undone.
    return { status: decision === "dismissed" ? "dismissed" : "open", range: at };
  }
  if (decision === "accepted") {
    const start = mapBoundary(map, s.start, "left");
    const end = mapBoundary(map, s.end, "right");
    return { status: "accepted", range: start !== null && end !== null && start <= end ? { start, end } : null };
  }
  return { status: decision === "dismissed" ? "dismissed" : "stale", range: null };
}

export type EditResult = { ok: true; edit: TextEdit } | { ok: false; reason: "protected" | "stale" | "not_open"; message: string };

export const PROTECTED_MESSAGE = "This record is protected. Tick the protection box below the text to accept or undo suggestions.";
export const STALE_MESSAGE = "The text here has changed since proofreading, so this suggestion no longer applies.";

/** The edit that accepts a suggestion: exactly its original characters, at their current place. */
export function acceptEdit(located: LocatedSuggestion, s: ProofreadSuggestion, editable: boolean): EditResult {
  if (!editable) return { ok: false, reason: "protected", message: PROTECTED_MESSAGE };
  if (located.status === "stale") return { ok: false, reason: "stale", message: STALE_MESSAGE };
  if (located.status !== "open" || !located.range) return { ok: false, reason: "not_open", message: "This suggestion is not open." };
  return { ok: true, edit: { start: located.range.start, end: located.range.end, text: s.replacement } };
}

/** The edit that puts an accepted suggestion's original text back, if its replacement is still there unchanged. */
export function undoEdit(current: string, located: LocatedSuggestion, s: ProofreadSuggestion, editable: boolean): EditResult {
  if (!editable) return { ok: false, reason: "protected", message: PROTECTED_MESSAGE };
  if (located.status !== "accepted") return { ok: false, reason: "not_open", message: "This suggestion is not accepted." };
  const r = located.range;
  if (!r || current.slice(r.start, r.end) !== s.replacement) {
    return {
      ok: false,
      reason: "stale",
      message: "The text around this correction has changed, so it cannot be undone here. Use Ctrl+Z in the text box.",
    };
  }
  return { ok: true, edit: { start: r.start, end: r.end, text: s.original } };
}

/** Index of the next (or previous) open suggestion after `from`, wrapping; -1 if none is open. */
export function nextOpen(located: readonly LocatedSuggestion[], from: number, direction: 1 | -1): number {
  const n = located.length;
  for (let step = 1; step <= n; step++) {
    const i = (((from + direction * step) % n) + n) % n;
    if (located[i].status === "open") return i;
  }
  return -1;
}
