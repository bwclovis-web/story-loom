import { compareBookOrder } from "@/domain/bookOrder";
import type { RecordNavEntry } from "./navigation";

export interface TreeScene {
  id: string;
  title: string;
}

export interface TreeChapter {
  id: string;
  title: string;
  scenes: TreeScene[];
}

export interface ManuscriptTree {
  chapters: TreeChapter[];
  /** Scenes whose chapter is not in this project's list; normally empty. */
  unplaced: TreeScene[];
}

/** Chapters and their scenes in book order. */
export function buildManuscriptTree(records: readonly RecordNavEntry[]): ManuscriptTree {
  const chapters = records.filter((r) => r.type === "manuscript_chapter").sort(compareBookOrder);
  const scenes = records.filter((r) => r.type === "manuscript_scene").sort(compareBookOrder);
  const byChapter = new Map<string, TreeScene[]>(chapters.map((c) => [c.id, []]));
  const unplaced: TreeScene[] = [];
  for (const s of scenes) {
    const list = s.parentRecordId ? byChapter.get(s.parentRecordId) : undefined;
    (list ?? unplaced).push({ id: s.id, title: s.title });
  }
  return {
    chapters: chapters.map((c) => ({ id: c.id, title: c.title, scenes: byChapter.get(c.id)! })),
    unplaced,
  };
}

/**
 * Keeps chapters whose title matches, with all their scenes, and chapters with
 * matching scenes, with only those scenes. Case-insensitive substring match.
 */
export function filterManuscriptTree(tree: ManuscriptTree, query: string): ManuscriptTree & { matchCount: number } {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return { ...tree, matchCount: 0 };
  const hit = (title: string) => title.toLocaleLowerCase().includes(q);
  let matchCount = 0;
  const chapters: TreeChapter[] = [];
  for (const c of tree.chapters) {
    const scenes = c.scenes.filter((s) => hit(s.title));
    matchCount += scenes.length;
    if (hit(c.title)) {
      matchCount += 1;
      chapters.push(c);
    } else if (scenes.length) {
      chapters.push({ ...c, scenes });
    }
  }
  const unplaced = tree.unplaced.filter((s) => hit(s.title));
  matchCount += unplaced.length;
  return { chapters, unplaced, matchCount };
}

/** The chapter that contains a record (the record itself if it is a chapter), for expanding the tree. */
export function chapterOf(records: readonly RecordNavEntry[], recordId: string | null): string | null {
  if (!recordId) return null;
  const byId = new Map(records.map((r) => [r.id, r]));
  let r = byId.get(recordId);
  // Notes hang off a chapter or a scene; scenes hang off a chapter.
  for (let depth = 0; r && depth < 3; depth++) {
    if (r.type === "manuscript_chapter") return r.id;
    r = r.parentRecordId ? byId.get(r.parentRecordId) : undefined;
  }
  return null;
}
