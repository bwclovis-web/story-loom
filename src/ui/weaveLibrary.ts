import { WEAVE_VIEW_KINDS, WEAVE_VIEW_LABELS, type WeaveViewKind } from "@/server/services/weaveService";

export interface WeaveLibraryGrid {
  id: string;
  title: string;
  viewKind: WeaveViewKind;
  viewLabel: string;
  beatCount: number;
}

export type WeaveLibraryEntry =
  | { kind: "grid"; grid: WeaveLibraryGrid }
  | { kind: "missing"; viewKind: WeaveViewKind; viewLabel: string };

/**
 * Grids in scope order (Original plan, Zero-draft story map, Author rewrite plan).
 * Within a scope, keep the order `listWeaveGrids` already applied.
 * A scope with no grids is one setup row. A scope with grids never also says "not created".
 * Search matches grid titles and scope labels. It does not invent a featured grid.
 */
export function weaveLibraryEntries(grids: readonly WeaveLibraryGrid[], query: string): WeaveLibraryEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  const matches = (value: string) => value.toLocaleLowerCase().includes(needle);
  const entries: WeaveLibraryEntry[] = [];
  for (const viewKind of WEAVE_VIEW_KINDS) {
    const ofKind = grids.filter((grid) => grid.viewKind === viewKind);
    const label = WEAVE_VIEW_LABELS[viewKind];
    if (ofKind.length === 0) {
      if (!needle || matches(label)) entries.push({ kind: "missing", viewKind, viewLabel: label });
      continue;
    }
    for (const grid of ofKind) {
      if (!needle || matches(grid.title) || matches(grid.viewLabel)) entries.push({ kind: "grid", grid });
    }
  }
  return entries;
}
