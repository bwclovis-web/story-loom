/**
 * Shared query parsing for world-bible export routes (wiki/md/docx/epub/pdf).
 */

import { isManuscriptType, isRecordType, type RecordType } from "@/domain/recordTypes";
import type { WorldBiblePolicy, WorldBibleSelection } from "./worldBibleModel";

export function parseWorldBibleExportQuery(searchParams: URLSearchParams): {
  selection: WorldBibleSelection;
  policy: WorldBiblePolicy;
} {
  const recordIds = searchParams.getAll("record").filter(Boolean);
  const types = searchParams
    .getAll("type")
    .filter((type): type is RecordType => isRecordType(type) && !isManuscriptType(type));

  const collectionId = searchParams.get("collection");
  const category = searchParams.get("category");
  const subcategory = searchParams.get("subcategory");
  const tag = searchParams.get("tag");
  const customKind = searchParams.get("customKind");
  const unclassified = searchParams.get("unclassified") === "1" || searchParams.get("unclassified") === "true";

  const selection: WorldBibleSelection = {
    recordIds: recordIds.length ? recordIds : undefined,
    types: types.length ? types : undefined,
    collectionId: collectionId || null,
    category: category || null,
    subcategory: subcategory || null,
    tag: tag || null,
    customKind: customKind || null,
    unclassified: unclassified || undefined,
  };

  const modeRaw = searchParams.get("mode");
  const spoilerBefore = searchParams.get("spoilerBefore");
  const ceiling = searchParams.get("ceiling");
  const book = searchParams.get("book");

  let mode: WorldBiblePolicy["mode"] = "full";
  if (modeRaw === "point" || spoilerBefore) mode = "point";

  const approvedOnly =
    ceiling === "approved" ? true : ceiling === "all" ? false : mode === "point" ? true : false;

  const policy: WorldBiblePolicy = {
    mode,
    storyPointRecordId: spoilerBefore || null,
    bookProjectId: book || null,
    approvedOnly,
  };

  return { selection, policy };
}

export function worldBibleSelectionHasScope(selection: WorldBibleSelection): boolean {
  return Boolean(
    selection.recordIds?.length ||
      selection.types?.length ||
      selection.collectionId ||
      selection.category ||
      selection.subcategory ||
      selection.tag ||
      selection.customKind ||
      selection.unclassified,
  );
}
