/**
 * W7C shared world-bible selection, taxonomy grouping, and export model.
 * Domain assembly lives here; format writers consume WorldBibleExportModel.
 */

import "server-only";
import type { NarrativePoint } from "@/domain/characterDevelopment";
import {
  redactCharacterFieldsForExport,
  writingContextPolicy,
  type WritingContextMode,
} from "@/domain/characterWritingContext";
import { renderCharacterContextSlice } from "@/domain/characterDevelopment";
import { readCharacterDevelopment, developmentIsEmpty } from "@/domain/characterDevelopment";
import type { JsonObject } from "@/domain/json";
import type { RecordView } from "@/domain/records";
import { isManuscriptType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import {
  formatWorldProfileFieldValue,
  isWorldProfileRecordType,
  readWorldProfile,
  WORLD_PROFILE_KEY,
  type WorldProfileFieldValue,
} from "@/domain/worldProfile";
import { resolveWorldFieldsAtPoint } from "@/domain/worldProfileHistory";
import {
  redactWorldFieldsForExport,
  stripUnsettledAndOverlappingBody,
} from "@/domain/worldWritingContext";
import { WORLD_MARKDOWN_ARCHIVE_KEY } from "@/domain/worldProfileUpgrade";
import { DOSSIER_MARKDOWN_ARCHIVE_KEY } from "@/domain/characterDossierUpgrade";
import { CHARACTER_DEVELOPMENT_KEY } from "@/domain/characterDevelopment";
import type { OrderEdge } from "@/world/storyOrder";
import {
  getTaxonomyCategory,
  getTaxonomySubcategory,
  resolveRecordTaxonomy,
  type TaxonomyPlacement,
} from "@/world/taxonomy";
import { categoryLabelOrCustom, projectWorldHubRecord } from "@/world/hubDiscovery";
import { applyWorldCollectionFilter } from "@/world/worldHubCollections";
import { seriesBookLabel, type SeriesHomeRef } from "@/world/seriesHome";
import type { DbOrTx } from "../db";
import { NotFoundError } from "./errors";
import {
  loadFocusManuscript,
  narrativePointForManuscript,
} from "./characterWritingContextService";
import { listEstablishedFactsForSubject, type EstablishedFactView } from "./establishedFactService";
import { listAvailableWorldCategories, type WorldCategoryView } from "./worldCategoryService";
import {
  listAvailableWorldKindTemplates,
  listWorldKindTemplates,
  resolveProfileDefinitionForRecord,
} from "./worldKindTemplateService";
import { listPlaceRelationsForRecord, type PlaceRelationView } from "./placeRelationService";
import { listRecordRelationsForRecord, type RecordRelationView } from "./recordRelationService";
import {
  listAvailableReferences,
  resolveAvailableReference,
  type AvailableReference,
} from "./seriesBibleService";
import { getSmartCollection } from "./smartCollectionService";
import { LIVE_PROJECT } from "./trashFilters";
import { booksFromIds } from "./worldWritingContextService";
import { exportSlug } from "./manuscriptExportModel";
import {
  listSubcategorySectionsWithStoredValues,
  type WorldProfileDefinition,
  type WorldProfileFieldDef,
} from "@/world/worldProfileRegistry";
import { withSeriesBookOrderFallback } from "@/domain/characterWritingContext";

export type WorldBibleExportMode = "full" | "point";

export interface WorldBibleSelection {
  recordIds?: readonly string[];
  types?: readonly RecordType[];
  collectionId?: string | null;
  category?: string | null;
  subcategory?: string | null;
  tag?: string | null;
  customKind?: string | null;
  unclassified?: boolean;
}

export interface WorldBiblePolicy {
  mode: WorldBibleExportMode;
  /** Chapter or scene that anchors story chronology (point mode). */
  storyPointRecordId?: string | null;
  /** Override viewing book for series chronology; defaults to projectId. */
  bookProjectId?: string | null;
  /** Drop non-approved references. Default true in point mode, false in full. */
  approvedOnly?: boolean;
}

export interface WorldBibleFieldRow {
  key: string;
  label: string;
  value: string;
  hrefRecordId?: string | null;
}

export interface WorldBibleRelationRow {
  label: string;
  targetRecordId: string;
  targetTitle: string;
}

export interface WorldBibleEntry {
  record: RecordView;
  home: SeriesHomeRef | null;
  homeLabel: string | null;
  primary: TaxonomyPlacement | null;
  secondary: TaxonomyPlacement[];
  categoryLabel: string;
  subcategoryLabel: string | null;
  /** Stable basename without extension: slug-id */
  pageId: string;
  fields: WorldBibleFieldRow[];
  relations: WorldBibleRelationRow[];
  /** Body already filtered for the active policy. */
  body: string;
  /** Character slice when type is character_dossier and profile is non-empty. */
  characterSlice: string | null;
  facts: string[];
  openQuestions: string | null;
}

export interface WorldBibleIndexSee {
  categoryId: string;
  categoryLabel: string;
  subcategoryId: string | null;
  subcategoryLabel: string | null;
  recordId: string;
  title: string;
  pageId: string;
}

export interface WorldBibleGroup {
  categoryId: string;
  categoryLabel: string;
  subcategoryId: string | null;
  subcategoryLabel: string | null;
  entries: WorldBibleEntry[];
  seeAlso: WorldBibleIndexSee[];
}

export interface WorldBibleExportModel {
  projectId: string;
  projectTitle: string;
  mode: WorldBibleExportMode;
  approvedOnly: boolean;
  storyPointLabel: string | null;
  spoilerNote: string | null;
  point: NarrativePoint | null;
  edges: OrderEdge[];
  bookIds: string[];
  entries: WorldBibleEntry[];
  groups: WorldBibleGroup[];
  allowedRecordIds: Set<string>;
  pageById: Map<string, string>;
  /** Ambiguous title/alias terms are omitted so same-title records stay distinct. */
  linkTerms: Map<string, string>;
  customCategories: WorldCategoryView[];
}

function pageIdOf(record: Pick<RecordView, "id" | "title">): string {
  return `${exportSlug(record.title)}-${record.id}`;
}

function placementLabel(
  placement: TaxonomyPlacement | null,
  customs: readonly WorldCategoryView[],
): { categoryLabel: string; subcategoryLabel: string | null } {
  if (!placement) return { categoryLabel: "Uncategorized", subcategoryLabel: null };
  const customOpts = customs.map((c) => ({
    slug: c.slug,
    label: c.label,
    parentCategorySlug: c.parentCategorySlug,
  }));
  const categoryLabel = categoryLabelOrCustom(placement.category, customOpts);
  const subcategoryLabel = placement.subcategory
    ? getTaxonomySubcategory(placement.category, placement.subcategory)?.label ??
      customs.find((c) => c.slug === placement.subcategory)?.label ??
      placement.subcategory
    : null;
  return { categoryLabel, subcategoryLabel };
}

function groupKey(categoryId: string, subcategoryId: string | null): string {
  return `${categoryId}\0${subcategoryId ?? ""}`;
}

async function resolveSelectionIds(
  db: DbOrTx,
  projectId: string,
  selection: WorldBibleSelection,
): Promise<string[]> {
  const available = await listAvailableReferences(db, projectId, { worldOnly: false, linkableOnly: false });
  const hubRecords = available
    .filter((entry) => !isManuscriptType(entry.record.type))
    .map((entry) =>
      projectWorldHubRecord({
        id: entry.record.id,
        title: entry.record.title,
        type: entry.record.type,
        authorityStatus: entry.record.authorityStatus,
        protected: entry.record.protected,
        currentRevision: entry.record.currentRevision,
        worldScope: entry.record.worldScope,
        createdAt: entry.record.createdAt,
        updatedAt: entry.record.updatedAt,
        fields: entry.record.fields,
        home: entry.home,
      }),
    );

  if (selection.collectionId) {
    const collection = await getSmartCollection(db, projectId, selection.collectionId);
    if (collection.scope !== "world") {
      throw new NotFoundError("That collection is not a World Hub collection.");
    }
    return applyWorldCollectionFilter(hubRecords, collection.filter).map((r) => r.id);
  }

  if (selection.recordIds?.length) {
    return [...new Set(selection.recordIds)];
  }

  let rows = hubRecords;
  if (selection.types?.length) {
    const types = new Set(selection.types);
    rows = rows.filter((r) => types.has(r.type));
  }
  if (
    selection.category ||
    selection.subcategory ||
    selection.tag ||
    selection.customKind ||
    selection.unclassified
  ) {
    rows = applyWorldCollectionFilter(rows, {
      category: selection.category ?? undefined,
      subcategory: selection.subcategory ?? undefined,
      tag: selection.tag ?? undefined,
      customKind: selection.customKind ?? undefined,
      unclassified: selection.unclassified || undefined,
      list: true,
    });
  }
  return rows.map((r) => r.id);
}

function representedPathsForBody(fields: Readonly<Record<string, unknown>>): Set<string> {
  const paths = new Set<string>();
  const read = readWorldProfile(fields);
  if (read.ok) {
    if (read.profile.summary.trim()) paths.add("summary");
    for (const key of Object.keys(read.profile.values)) paths.add(`values.${key}`);
    for (const change of read.profile.fieldHistory) paths.add(change.fieldPath);
  }
  for (const key of Object.keys(fields)) {
    if (
      key === WORLD_PROFILE_KEY ||
      key === WORLD_MARKDOWN_ARCHIVE_KEY ||
      key === DOSSIER_MARKDOWN_ARCHIVE_KEY ||
      key === CHARACTER_DEVELOPMENT_KEY ||
      key === "taxonomy"
    ) {
      continue;
    }
    paths.add(`fields.${key}`);
  }
  return paths;
}

function filterBodyForPolicy(
  body: string,
  fields: Readonly<Record<string, unknown>>,
  mode: WorldBibleExportMode,
): string {
  if (mode !== "point") return body;
  const stripped = stripUnsettledAndOverlappingBody(body, representedPathsForBody(fields));
  if (!stripped.trim()) return "";
  return stripped;
}

function openQuestionsFromBody(body: string): string | null {
  const match = body.match(/^#{1,6}\s*Open questions\b[^\n]*\n([\s\S]*?)(?=^#{1,6}\s|\Z)/im);
  if (!match) return null;
  const text = (match[1] ?? "").trim();
  return text || null;
}

function buildLinkIndex(entries: readonly WorldBibleEntry[]): {
  linkTerms: Map<string, string>;
  pageById: Map<string, string>;
} {
  const pageById = new Map<string, string>();
  const counts = new Map<string, number>();
  const candidates: Array<{ term: string; pageId: string }> = [];
  for (const entry of entries) {
    pageById.set(entry.record.id, entry.pageId);
    const terms = new Set<string>([entry.record.title]);
    const aliases = entry.record.fields.aliases;
    if (Array.isArray(aliases)) {
      for (const alias of aliases) {
        if (typeof alias === "string" && alias.trim()) terms.add(alias.trim());
      }
    }
    for (const term of terms) {
      const key = term.toLocaleLowerCase();
      if (key.length < 2) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      candidates.push({ term: key, pageId: entry.pageId });
    }
  }
  const linkTerms = new Map<string, string>();
  for (const { term, pageId } of candidates) {
    if ((counts.get(term) ?? 0) !== 1) continue;
    if (!linkTerms.has(term)) linkTerms.set(term, pageId);
  }
  return { linkTerms, pageById };
}

function displayFieldValue(
  raw: WorldProfileFieldValue,
  titleById: ReadonlyMap<string, string>,
): { text: string; hrefRecordId: string | null } | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "recordId" in raw && !("freeText" in raw)) {
    const id = String((raw as { recordId: string }).recordId);
    if (!titleById.has(id)) return null;
    return { text: titleById.get(id) ?? id, hrefRecordId: id };
  }
  const formatted = formatWorldProfileFieldValue(raw).trim();
  if (
    !formatted &&
    raw !== 0 &&
    !(typeof raw === "object" && raw && "amount" in raw && (raw as { amount: number }).amount === 0)
  ) {
    return null;
  }
  return { text: formatted || formatWorldProfileFieldValue(raw), hrefRecordId: null };
}

function fieldRowsFromDefinition(
  definition: WorldProfileDefinition | null,
  fields: Readonly<Record<string, unknown>>,
  mode: WorldBibleExportMode,
  point: NarrativePoint | null,
  edges: readonly OrderEdge[],
  books: ReturnType<typeof booksFromIds>,
  viewingProjectId: string,
  titleById: ReadonlyMap<string, string>,
): WorldBibleFieldRow[] {
  const read = readWorldProfile(fields);
  if (!read.ok) return [];
  const profile = read.profile;
  const rows: WorldBibleFieldRow[] = [];
  const seen = new Set<string>();

  const push = (key: string, label: string, raw: WorldProfileFieldValue) => {
    if (seen.has(key)) return;
    const displayed = displayFieldValue(raw, titleById);
    if (!displayed) return;
    seen.add(key);
    rows.push({
      key,
      label,
      value: displayed.text,
      hrefRecordId: displayed.hrefRecordId,
    });
  };

  const defs: WorldProfileFieldDef[] = [
    ...(definition?.fields ?? []),
    ...listSubcategorySectionsWithStoredValues(profile).flatMap((section) => [...section.fields]),
  ];

  if (mode === "point" && point) {
    const resolved = resolveWorldFieldsAtPoint(profile, point, edges, {
      books,
      viewingProjectId,
    });
    if (profile.summary.trim() && resolved.fields.summary?.presence === "set") {
      push("summary", "Summary", resolved.fields.summary.value);
    }
    for (const field of defs) {
      const path = field.storage === "flat" ? `fields.${field.key}` : `values.${field.key}`;
      const at = resolved.fields[path];
      if (at?.presence === "set") push(field.key, field.label, at.value);
      else if (field.storage === "flat") {
        const flat = fields[field.key];
        if (typeof flat === "string" || typeof flat === "number" || typeof flat === "boolean") {
          // Flat fields without history stay available only in full mode; point mode already
          // handled undated via resolveWorldFieldsAtPoint unknown.
        }
      }
    }
    // Also include resolved values that have history but no definition label.
    for (const [path, value] of Object.entries(resolved.fields)) {
      if (value.presence !== "set") continue;
      const key = path.replace(/^values\./, "").replace(/^fields\./, "");
      if (seen.has(key) || key === "summary") continue;
      const def = defs.find((f) => f.key === key);
      push(key, def?.label ?? key, value.value);
    }
  } else {
    if (profile.summary.trim()) push("summary", "Summary", profile.summary);
    for (const field of defs) {
      if (field.storage === "flat") {
        const flat = fields[field.key];
        if (flat === undefined || flat === null || flat === "") continue;
        push(field.key, field.label, flat as WorldProfileFieldValue);
      } else {
        const raw = profile.values[field.key];
        if (raw === undefined) continue;
        push(field.key, field.label, raw);
      }
    }
    for (const [key, raw] of Object.entries(profile.values)) {
      if (seen.has(key)) continue;
      const def = defs.find((f) => f.key === key);
      push(key, def?.label ?? key, raw);
    }
  }
  return rows;
}

function relationRowsFor(
  place: { outgoing: PlaceRelationView[]; incoming: PlaceRelationView[] },
  recordRels: { outgoing: RecordRelationView[]; incoming: RecordRelationView[] },
  allowedRecordIds: ReadonlySet<string>,
): WorldBibleRelationRow[] {
  const out: WorldBibleRelationRow[] = [];
  for (const row of place.outgoing) {
    if (!allowedRecordIds.has(row.toRecordId)) continue;
    out.push({ label: row.kindLabel, targetRecordId: row.toRecordId, targetTitle: row.toTitle });
  }
  for (const row of place.incoming) {
    if (!allowedRecordIds.has(row.fromRecordId)) continue;
    out.push({
      label: `${row.kindLabel} (incoming)`,
      targetRecordId: row.fromRecordId,
      targetTitle: row.fromTitle,
    });
  }
  for (const row of recordRels.outgoing) {
    if (!allowedRecordIds.has(row.toRecordId)) continue;
    out.push({ label: row.kindLabel, targetRecordId: row.toRecordId, targetTitle: row.toTitle });
  }
  for (const row of recordRels.incoming) {
    if (!allowedRecordIds.has(row.fromRecordId)) continue;
    out.push({
      label: `${row.kindLabel} (incoming)`,
      targetRecordId: row.fromRecordId,
      targetTitle: row.fromTitle,
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label) || a.targetTitle.localeCompare(b.targetTitle));
  return out;
}

/**
 * Build the shared world-bible export model for all five formats.
 */
export async function buildWorldBibleExportModel(
  db: DbOrTx,
  projectId: string,
  selection: WorldBibleSelection,
  policy: WorldBiblePolicy = { mode: "full" },
): Promise<WorldBibleExportModel> {
  const project = await db.project.findFirst({
    where: { id: projectId, ...LIVE_PROJECT },
    select: { id: true, title: true },
  });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);

  const approvedOnly = policy.approvedOnly ?? policy.mode === "point";
  const mode = policy.mode;
  const selectedIds = await resolveSelectionIds(db, projectId, selection);

  const resolvedEntries: AvailableReference[] = [];
  for (const id of selectedIds) {
    const available = await resolveAvailableReference(db, projectId, id);
    if (!available) continue;
    if (isManuscriptType(available.record.type)) continue;
    if (approvedOnly && available.record.authorityStatus !== "approved") continue;
    resolvedEntries.push(available);
  }

  if (!resolvedEntries.length) {
    throw new NotFoundError(
      selection.collectionId
        ? "No reference documents match that World Hub collection under the current export visibility rules."
        : "No reference documents were selected.",
    );
  }

  const customs = await listAvailableWorldCategories(db, projectId);
  const homeTemplateCache = new Map<string, Awaited<ReturnType<typeof listWorldKindTemplates>>>();
  const availableTemplates = await listAvailableWorldKindTemplates(db, projectId);

  let point: NarrativePoint | null = null;
  let edges: OrderEdge[] = [];
  let bookIds: string[] = [projectId];
  let storyPointLabel: string | null = null;

  if (mode === "point") {
    const focus = await loadFocusManuscript(db, projectId, policy.storyPointRecordId ?? null);
    const narrative = await narrativePointForManuscript(db, projectId, focus);
    point = narrative.point;
    if (policy.bookProjectId) {
      point = { ...point, bookProjectId: policy.bookProjectId };
    }
    edges = narrative.edges;
    bookIds = narrative.bookIds;
    if (focus) {
      storyPointLabel = focus.title;
    } else {
      storyPointLabel = "unanchored story point";
    }
  }

  const books = booksFromIds(bookIds);
  const worldPolicy = writingContextPolicy(
    (mode === "point" ? "drafting" : "editorial") as WritingContextMode,
    false,
  );

  const prepared: Array<{
    available: AvailableReference;
    record: RecordView;
    fields: JsonObject;
    body: string;
    characterSlice: string | null;
  }> = [];

  for (const available of resolvedEntries) {
    let fields = { ...(available.record.fields as JsonObject) };
    let body = available.record.body;
    let characterSlice: string | null = null;

    if (mode === "point" && isWorldProfileRecordType(available.record.type)) {
      fields = redactWorldFieldsForExport(fields, worldPolicy, {
        point,
        edges,
        books,
        viewingProjectId: projectId,
      });
      body = filterBodyForPolicy(body, fields, mode);
    } else if (mode === "point" && available.record.type === "character_dossier") {
      fields = redactCharacterFieldsForExport(fields, worldPolicy, {
        point: point ?? undefined,
        edges,
      });
      const read = readCharacterDevelopment(fields);
      if (!developmentIsEmpty(read.profile)) {
        const effective = withSeriesBookOrderFallback(read.profile, bookIds);
        characterSlice = renderCharacterContextSlice({
          title: available.record.title,
          body: available.record.body,
          profile: effective,
          slice: worldPolicy.slice,
          bookProjectId: point?.bookProjectId ?? projectId,
          point: point ?? undefined,
          edges,
          knowledgeHolders: worldPolicy.knowledgeHolders,
          includePlannedKnowledge: false,
        });
        body = "";
      } else {
        body = filterBodyForPolicy(body, fields, mode);
      }
    } else if (mode === "point") {
      body = filterBodyForPolicy(body, fields, mode);
    }

    // Never dump archives into body/fields for any mode in structured render.
    delete fields[WORLD_MARKDOWN_ARCHIVE_KEY];
    delete fields[DOSSIER_MARKDOWN_ARCHIVE_KEY];

    const record: RecordView = {
      ...available.record,
      fields,
      body,
    };
    prepared.push({ available, record, fields, body, characterSlice });
  }

  const allowedRecordIds = new Set(prepared.map((p) => p.record.id));
  const titleById = new Map(prepared.map((p) => [p.record.id, p.record.title] as const));
  const entries: WorldBibleEntry[] = [];

  for (const item of prepared) {
    const homeId = item.available.home?.projectId ?? item.record.projectId;
    if (!homeTemplateCache.has(homeId)) {
      homeTemplateCache.set(homeId, await listWorldKindTemplates(db, homeId));
    }
    const homeTemplates = homeTemplateCache.get(homeId) ?? [];
    const taxonomy = resolveRecordTaxonomy({ type: item.record.type, fields: item.fields });
    const categorySlugs = [
      ...(taxonomy.primary?.category ? [taxonomy.primary.category] : []),
      ...taxonomy.secondary.map((s) => s.category),
    ];
    const definition =
      isWorldProfileRecordType(item.record.type)
        ? resolveProfileDefinitionForRecord({
            fields: item.fields,
            recordProjectId: homeId,
            homeTemplates,
            availableTemplates,
            categorySlugs,
          })
        : null;

    const [place, recordRels, facts] = await Promise.all([
      listPlaceRelationsForRecord(db, projectId, item.record.id),
      listRecordRelationsForRecord(db, projectId, item.record.id),
      listEstablishedFactsForSubject(db, projectId, item.record.id).catch(() => [] as EstablishedFactView[]),
    ]);

    const acceptedFacts = facts
      .filter((f) => f.status === "accepted")
      .map((f) => f.statement.trim())
      .filter(Boolean)
      .slice(0, 12);

    const labels = placementLabel(taxonomy.primary, customs);
    entries.push({
      record: item.record,
      home: item.available.home,
      homeLabel: item.available.home ? seriesBookLabel(item.available.home) : null,
      primary: taxonomy.primary,
      secondary: taxonomy.secondary,
      categoryLabel: labels.categoryLabel,
      subcategoryLabel: labels.subcategoryLabel,
      pageId: pageIdOf(item.record),
      fields: isWorldProfileRecordType(item.record.type)
        ? fieldRowsFromDefinition(
            definition,
            item.fields,
            mode,
            point,
            edges,
            books,
            projectId,
            titleById,
          )
        : [],
      relations: relationRowsFor(place, recordRels, allowedRecordIds),
      body: item.body,
      characterSlice: item.characterSlice,
      facts: acceptedFacts,
      openQuestions: openQuestionsFromBody(item.body),
    });
  }

  entries.sort(
    (a, b) =>
      a.categoryLabel.localeCompare(b.categoryLabel) ||
      (a.subcategoryLabel ?? "").localeCompare(b.subcategoryLabel ?? "") ||
      a.record.title.localeCompare(b.record.title) ||
      a.record.id.localeCompare(b.record.id),
  );

  const { linkTerms, pageById } = buildLinkIndex(entries);
  const groupMap = new Map<string, WorldBibleGroup>();

  const ensureGroup = (categoryId: string, subcategoryId: string | null): WorldBibleGroup => {
    const key = groupKey(categoryId, subcategoryId);
    let group = groupMap.get(key);
    if (!group) {
      const labels = placementLabel(
        subcategoryId ? { category: categoryId, subcategory: subcategoryId } : { category: categoryId },
        customs,
      );
      group = {
        categoryId,
        categoryLabel: categoryId === "__uncategorized__" ? "Uncategorized" : labels.categoryLabel,
        subcategoryId,
        subcategoryLabel: subcategoryId ? labels.subcategoryLabel : null,
        entries: [],
        seeAlso: [],
      };
      groupMap.set(key, group);
    }
    return group;
  };

  for (const entry of entries) {
    const categoryId = entry.primary?.category ?? "__uncategorized__";
    const subcategoryId = entry.primary?.subcategory ?? null;
    ensureGroup(categoryId, subcategoryId).entries.push(entry);

    for (const secondary of entry.secondary) {
      const seeGroup = ensureGroup(secondary.category, secondary.subcategory ?? null);
      seeGroup.seeAlso.push({
        categoryId: secondary.category,
        categoryLabel: seeGroup.categoryLabel,
        subcategoryId: secondary.subcategory ?? null,
        subcategoryLabel: seeGroup.subcategoryLabel,
        recordId: entry.record.id,
        title: entry.record.title,
        pageId: entry.pageId,
      });
    }
  }

  const groups = [...groupMap.values()].sort(
    (a, b) =>
      a.categoryLabel.localeCompare(b.categoryLabel) ||
      (a.subcategoryLabel ?? "").localeCompare(b.subcategoryLabel ?? ""),
  );

  const spoilerParts: string[] = [];
  if (approvedOnly) spoilerParts.push("Only approved references are included.");
  if (mode === "point") {
    spoilerParts.push(
      storyPointLabel
        ? `Point-scoped export as of “${storyPointLabel}”. Planned changes, archives, sibling book-local facts, and unapproved material are omitted throughout the artifact (index, articles, links, captions).`
        : "Point-scoped export without a linked story event: undated current values are not treated as earlier story truth; planned and archive material are omitted.",
    );
    spoilerParts.push(
      "Legacy prose whose story chronology cannot be established is labeled as uncertain background when retained; unsettled status-tagged sections are omitted.",
    );
  }
  const spoilerNote = spoilerParts.length ? spoilerParts.join(" ") : null;

  return {
    projectId,
    projectTitle: project.title,
    mode,
    approvedOnly,
    storyPointLabel,
    spoilerNote,
    point,
    edges,
    bookIds,
    entries,
    groups,
    allowedRecordIds,
    pageById,
    linkTerms,
    customCategories: customs,
  };
}

export function worldBibleEntryHref(entry: Pick<WorldBibleEntry, "pageId">, format: "wiki" | "md" | "epub" | "anchor"): string {
  switch (format) {
    case "wiki":
      return `pages/${entry.pageId}.html`;
    case "md":
      return `${entry.pageId}.md`;
    case "epub":
      return `${entry.pageId}.xhtml`;
    case "anchor":
      return `#rec-${entry.pageId}`;
  }
}

export { RECORD_TYPE_LABELS, getTaxonomyCategory };
