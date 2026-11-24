export const MANUSCRIPT_SCENE_STATUSES = ["outline", "rough", "revised", "final"] as const;

export type ManuscriptSceneStatus = (typeof MANUSCRIPT_SCENE_STATUSES)[number];

export interface ManuscriptMeta {
  pov: string;
  sceneStatus: ManuscriptSceneStatus | "";
  storyDateNote: string;
}

const POV_MAX = 200;
const DATE_MAX = 500;

export function isManuscriptSceneStatus(value: unknown): value is ManuscriptSceneStatus {
  return typeof value === "string" && (MANUSCRIPT_SCENE_STATUSES as readonly string[]).includes(value);
}

export function readManuscriptMeta(fields: Readonly<Record<string, unknown>>): ManuscriptMeta {
  return {
    pov: typeof fields.pov === "string" ? fields.pov : "",
    sceneStatus: isManuscriptSceneStatus(fields.sceneStatus) ? fields.sceneStatus : "",
    storyDateNote: typeof fields.storyDateNote === "string" ? fields.storyDateNote : "",
  };
}

/** Sets or clears pov, sceneStatus, and storyDateNote. Every other key stays. */
export function withManuscriptMeta(
  fields: Readonly<Record<string, unknown>>,
  patch: Partial<ManuscriptMeta>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...fields };
  if (patch.pov !== undefined) {
    const pov = patch.pov.slice(0, POV_MAX);
    if (!pov.trim()) delete next.pov;
    else next.pov = pov;
  }
  if (patch.sceneStatus !== undefined) {
    if (!patch.sceneStatus) delete next.sceneStatus;
    else if (isManuscriptSceneStatus(patch.sceneStatus)) next.sceneStatus = patch.sceneStatus;
  }
  if (patch.storyDateNote !== undefined) {
    const note = patch.storyDateNote.slice(0, DATE_MAX);
    if (!note.trim()) delete next.storyDateNote;
    else next.storyDateNote = note;
  }
  return next;
}

/**
 * Text before `at` stays. Text from `at` onward is the new document.
 * Boundary whitespace is not copied into either side. `tailOffset` is where
 * the kept tail begins in the original string.
 */
export function splitManuscriptBody(body: string, at: number): { head: string; tail: string; tailOffset: number } | null {
  if (!Number.isInteger(at) || at <= 0 || at >= body.length) return null;
  const head = body.slice(0, at).replace(/\s+$/, "");
  const rawTail = body.slice(at);
  const lead = rawTail.length - rawTail.replace(/^\s+/, "").length;
  const tail = rawTail.slice(lead);
  if (!head || !tail) return null;
  return { head, tail, tailOffset: at + lead };
}

/** Keep, then a blank line, then the other text. An empty side is omitted. */
export function mergeManuscriptBodies(keep: string, drop: string): { body: string; dropOffset: number } {
  const left = keep.replace(/\s+$/, "");
  const right = drop.replace(/^\s+/, "");
  if (!left) return { body: right, dropOffset: 0 };
  if (!right) return { body: left, dropOffset: left.length };
  return { body: `${left}\n\n${right}`, dropOffset: left.length + 2 };
}

/** Same break lines the chapter editor uses to nest scenes (`---`, `***`, `* * *`, `#`, `⁂`). */
const SCENE_BREAK = /^ {0,3}(?:([-*_])(?:[ \t]*\1){2,}|#|⁂)[ \t]*$/;

function countSceneBreaks(text: string): number {
  if (!text) return 0;
  return text.split("\n").reduce((sum, line) => sum + (SCENE_BREAK.test(line) ? 1 : 0), 0);
}

function joinWithSceneBreak(head: string, tail: string): { chapterBody: string; breakStart: number; breakEnd: number } {
  const marker = "***";
  if (!head && !tail) return { chapterBody: marker, breakStart: 0, breakEnd: marker.length };
  if (!head) {
    const chapterBody = `${marker}\n\n${tail}`;
    return { chapterBody, breakStart: 0, breakEnd: marker.length };
  }
  if (!tail) {
    const chapterBody = `${head}\n\n${marker}`;
    const breakStart = head.length + 2;
    return { chapterBody, breakStart, breakEnd: breakStart + marker.length };
  }
  const chapterBody = `${head}\n\n${marker}\n\n${tail}`;
  const breakStart = head.length + 2;
  return { chapterBody, breakStart, breakEnd: breakStart + marker.length };
}

/**
 * Turn a selected chapter passage into a scene body and leave a `***` break at the cut.
 * `breakIndex` is how many scene-break lines already sit in the kept head (0-based scene order).
 * `selectionStart` / `selectionEnd` are the trimmed passage bounds in the original body.
 * `tailStartInChapter` is where the kept after-text begins in the new chapter body.
 */
export function extractSelectionAsSceneBody(
  body: string,
  start: number,
  end: number,
): {
  chapterBody: string;
  sceneBody: string;
  breakIndex: number;
  selectionStart: number;
  selectionEnd: number;
  tailStartInChapter: number;
} | null {
  const normalized = body.replace(/\r\n?/g, "\n");
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > normalized.length || start >= end) {
    return null;
  }
  const raw = normalized.slice(start, end);
  const lead = raw.length - raw.replace(/^\s+/, "").length;
  const trimmed = raw.slice(lead).replace(/\s+$/, "");
  if (!trimmed) return null;
  const selectionStart = start + lead;
  const selectionEnd = selectionStart + trimmed.length;
  const head = normalized.slice(0, selectionStart).replace(/\s+$/, "");
  const tail = normalized.slice(selectionEnd).replace(/^\s+/, "");
  const breakIndex = countSceneBreaks(head);
  const joined = joinWithSceneBreak(head, tail);
  // After `***`, joinWithSceneBreak always uses `\n\n` before a non-empty tail.
  const tailStartInChapter = !tail ? joined.chapterBody.length : joined.breakEnd + 2;
  return {
    chapterBody: joined.chapterBody,
    sceneBody: trimmed,
    breakIndex,
    selectionStart,
    selectionEnd,
    tailStartInChapter,
  };
}

/**
 * Resolve extract bounds from editor offsets, preferring the captured selected
 * string when offsets drifted (composed chapter view / focus changes).
 */
export function resolveExtractSelection(
  body: string,
  start: number,
  end: number,
  selectedText?: string,
): {
  chapterBody: string;
  sceneBody: string;
  breakIndex: number;
  selectionStart: number;
  selectionEnd: number;
  tailStartInChapter: number;
} | null {
  const normalized = body.replace(/\r\n?/g, "\n");
  const want = selectedText?.replace(/\r\n?/g, "\n");
  if (want && want.length > 0) {
    if (normalized.slice(start, end) === want) {
      return extractSelectionAsSceneBody(normalized, start, end);
    }
    const hint = Number.isInteger(start) && start >= 0 ? start : 0;
    let from = normalized.indexOf(want, Math.max(0, hint - want.length));
    if (from < 0) from = normalized.indexOf(want);
    if (from >= 0) {
      // When the passage repeats, prefer the occurrence closest to the hint.
      let best = from;
      let next = normalized.indexOf(want, from + 1);
      while (next >= 0) {
        if (Math.abs(next - hint) < Math.abs(best - hint)) best = next;
        next = normalized.indexOf(want, next + 1);
      }
      return extractSelectionAsSceneBody(normalized, best, best + want.length);
    }
  }
  return extractSelectionAsSceneBody(normalized, start, end);
}
