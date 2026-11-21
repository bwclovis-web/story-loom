export type SplitKind = "chapter" | "scene";

export interface ManuscriptSplitOption {
  id: string;
  title: string;
  kind: SplitKind;
  /** Empty when the project has no manuscript drafts. */
  draftId: string;
  draftLabel: string;
}

export interface SplitTree {
  chapters: readonly { id: string; title: string; scenes: readonly { id: string; title: string }[] }[];
  unplaced: readonly { id: string; title: string }[];
}

export function splitOptionsFromTree(draftId: string, draftLabel: string, tree: SplitTree): ManuscriptSplitOption[] {
  const out: ManuscriptSplitOption[] = [];
  for (const chapter of tree.chapters) {
    out.push({ id: chapter.id, title: chapter.title, kind: "chapter", draftId, draftLabel });
    for (const scene of chapter.scenes) {
      out.push({ id: scene.id, title: scene.title, kind: "scene", draftId, draftLabel });
    }
  }
  for (const scene of tree.unplaced) {
    out.push({ id: scene.id, title: scene.title, kind: "scene", draftId, draftLabel });
  }
  return out;
}

/** Prefer a rewrite source that is actually in the list, then any other chapter or scene. */
export function suggestSplitPeer(
  options: readonly ManuscriptSplitOption[],
  currentId: string,
  preferredIds: readonly string[],
): string | null {
  const peers = options.filter((option) => option.id !== currentId);
  for (const id of preferredIds) {
    if (peers.some((option) => option.id === id)) return id;
  }
  const current = options.find((option) => option.id === currentId);
  if (current) {
    const otherDraft = peers.find((option) => option.draftId !== current.draftId);
    if (otherDraft) return otherDraft.id;
  }
  return peers[0]?.id ?? null;
}

export function splitGroups(options: readonly ManuscriptSplitOption[]): { draftId: string; draftLabel: string; options: ManuscriptSplitOption[] }[] {
  const groups: { draftId: string; draftLabel: string; options: ManuscriptSplitOption[] }[] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last.draftId === option.draftId) last.options.push(option);
    else groups.push({ draftId: option.draftId, draftLabel: option.draftLabel, options: [option] });
  }
  return groups;
}
