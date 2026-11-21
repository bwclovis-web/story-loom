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
