/**
 * Scene text shown inside a chapter editor. Locked ranges are the scene
 * bodies: they are visible in the chapter window and are not part of the
 * saved chapter.
 *
 * Each scene, in book order, is placed after the next scene break in the
 * chapter (`---`, `***`, `* * *`, `#`, `⁂`). Scenes past the last break
 * follow that break. With no break, they follow the chapter.
 */

export interface LockedRange {
  start: number;
  end: number;
}

export interface ComposedChapter {
  doc: string;
  locked: LockedRange[];
}

const SCENE_BREAK = /^ {0,3}(?:([-*_])(?:[ \t]*\1){2,}|#|⁂)[ \t]*$/;

function sceneBodies(scenes: readonly { body: string }[]): string[] {
  return scenes
    .map((scene) => scene.body.replace(/^\n+/, "").replace(/\s+$/, ""))
    .filter((body) => body.length > 0);
}

export function composeChapterWithScenes(chapter: string, scenes: readonly { body: string }[]): ComposedChapter {
  const bodies = sceneBodies(scenes);
  if (bodies.length === 0) return { doc: chapter, locked: [] };

  const lines = chapter.split("\n");
  const breaks = lines.flatMap((line, index) => (SCENE_BREAK.test(line) ? [index] : []));
  if (breaks.length === 0) {
    const tail = `\n\n${bodies.join("\n\n")}`;
    return { doc: chapter + tail, locked: [{ start: chapter.length, end: chapter.length + tail.length }] };
  }

  const atBreak = new Map<number, string[]>();
  breaks.forEach((lineNo, index) => {
    if (index < bodies.length) atBreak.set(lineNo, [bodies[index]!]);
  });
  if (bodies.length > breaks.length) {
    const last = breaks[breaks.length - 1]!;
    atBreak.set(last, [...(atBreak.get(last) ?? []), ...bodies.slice(breaks.length)]);
  }

  let doc = "";
  const locked: LockedRange[] = [];
  lines.forEach((line, index) => {
    if (index > 0) doc += "\n";
    doc += line;
    for (const body of atBreak.get(index) ?? []) {
      const chunk = `\n\n${body}\n`;
      const start = doc.length;
      doc += chunk;
      locked.push({ start, end: doc.length });
    }
  });
  return { doc, locked };
}

/** Scene prose stored in locked ranges, without the blank lines the composer adds. */
export function sceneBodiesFromDoc(doc: string, locked: readonly LockedRange[]): string[] {
  return locked
    .map((range) => doc.slice(range.start, range.end).replace(/^\n+/, "").replace(/\s+$/, ""))
    .filter((body) => body.length > 0);
}

/** Chapter text with scene ranges removed. */
export function chapterWithoutScenes(doc: string, locked: readonly LockedRange[]): string {
  const ranges = [...locked].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const range of ranges) {
    out += doc.slice(cursor, range.start);
    cursor = range.end;
  }
  return out + doc.slice(cursor);
}

/** Map an offset in the saved chapter onto the composed editor document. */
export function chapterOffsetToDoc(offset: number, locked: readonly LockedRange[]): number {
  let remaining = Math.max(0, offset);
  let last = 0;
  for (const range of locked) {
    const gap = range.start - last;
    if (remaining <= gap) return last + remaining;
    remaining -= gap;
    last = range.end;
  }
  return last + remaining;
}

/** Map an editor offset back onto the saved chapter. Points inside a scene land at its start. */
export function docOffsetToChapter(offset: number, locked: readonly LockedRange[]): number {
  let removed = 0;
  for (const range of locked) {
    if (offset <= range.start) return offset - removed;
    if (offset >= range.end) removed += range.end - range.start;
    else return range.start - removed;
  }
  return offset - removed;
}
