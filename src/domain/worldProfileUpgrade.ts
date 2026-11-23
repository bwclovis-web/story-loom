/**
 * Author-reviewed migration from Markdown worldbuilding documents into
 * Living World Profiles (`fields.worldProfile`). Pure analysis and merge
 * helpers — nothing here writes the database. Authority stays with the
 * author: proposals never become approved canon automatically, mysteries stay
 * unresolved, and unclassified or conflicting text is kept for review.
 */

import { newId } from "@/domain/ids";
import type { JsonObject } from "@/domain/json";
import { sha256, stableStringify } from "@/domain/json";
import type { AuthorityStatus } from "@/domain/statuses";
import {
  emptyWorldProfile,
  formatWorldProfileFieldValue,
  readWorldProfile,
  setWorldFieldMeta,
  withWorldProfile,
  worldFieldMetaOf,
  type WorldMigrationHoldItem,
  type WorldProfile,
  type WorldProfileFieldValue,
} from "@/domain/worldProfile";
import {
  CHANGE_PACKAGE_FORMAT,
  CHANGE_PACKAGE_FORMAT_VERSION,
  type ChangePackageV1,
} from "@/changePackage/schema.v1";
import { parseMarkdownSections, type MarkdownSection } from "@/domain/characterHeadingExtraction";
import type { WorldProfileDefinition, WorldProfileFieldDef } from "@/world/worldProfileRegistry";
import { WORLD_KIND_FIELD_SPECS } from "@/world/worldKinds";
import { isWorldKindKey } from "@/world/referenceTemplates";

export const WORLD_MARKDOWN_ARCHIVE_KEY = "worldMarkdownArchive";
export const WORLD_MARKDOWN_ARCHIVE_VERSION = 1 as const;

export const WORLD_UPGRADE_DECISIONS = [
  "accept",
  "keep_existing",
  "merge",
  "modify",
  "reject",
  "defer",
] as const;
export type WorldUpgradeDecision = (typeof WORLD_UPGRADE_DECISIONS)[number];

export type WorldUpgradeConfidence = "high" | "medium" | "low";

export interface WorldUpgradeHeadingMap {
  heading: string;
  fieldKey: string;
  confidence: WorldUpgradeConfidence;
  collectionKey?: string;
}

/** Common World outline headings → profile / flat field keys. */
export const WORLD_HEADING_MAP: readonly WorldUpgradeHeadingMap[] = [
  { heading: "Overview", fieldKey: "summary", confidence: "high" },
  { heading: "Summary", fieldKey: "summary", confidence: "high" },
  { heading: "Climate", fieldKey: "climate", confidence: "high" },
  { heading: "Parent place", fieldKey: "parentPlace", confidence: "high" },
  { heading: "Terrain", fieldKey: "terrain", confidence: "high" },
  { heading: "Boundaries", fieldKey: "boundaries", confidence: "high" },
  { heading: "Waterways", fieldKey: "waterways", confidence: "high" },
  { heading: "Travel constraints", fieldKey: "travelConstraints", confidence: "high" },
  { heading: "Travel", fieldKey: "travelConstraints", confidence: "medium" },
  { heading: "Population estimate", fieldKey: "populationEstimate", confidence: "high" },
  { heading: "Population", fieldKey: "populationEstimate", confidence: "medium" },
  { heading: "Principal industries", fieldKey: "principalIndustries", confidence: "high" },
  { heading: "Land area", fieldKey: "landArea", confidence: "high" },
  { heading: "Length", fieldKey: "length", confidence: "medium" },
  { heading: "Waterway source", fieldKey: "waterwaySource", confidence: "high" },
  { heading: "Outlet", fieldKey: "outlet", confidence: "high" },
  { heading: "Navigable stretches", fieldKey: "navigableStretches", confidence: "high" },
  { heading: "Layout", fieldKey: "layout", confidence: "high" },
  { heading: "Atmosphere", fieldKey: "atmosphere", confidence: "high" },
  { heading: "Access", fieldKey: "access", confidence: "high" },
  { heading: "Uses", fieldKey: "uses", confidence: "high" },
  { heading: "Distinctive features", fieldKey: "distinctiveFeatures", confidence: "high" },
  { heading: "Notable features", fieldKey: "distinctiveFeatures", confidence: "medium" },
  { heading: "Source", fieldKey: "source", confidence: "high" },
  { heading: "Workings", fieldKey: "workings", confidence: "high" },
  { heading: "Costs", fieldKey: "costs", confidence: "high" },
  { heading: "Limits", fieldKey: "limits", confidence: "high" },
  { heading: "Rules", fieldKey: "limits", confidence: "medium" },
  { heading: "Exceptions", fieldKey: "exceptions", confidence: "high" },
  { heading: "Ancestry", fieldKey: "ancestry", confidence: "high" },
  { heading: "Physiology", fieldKey: "physiology", confidence: "high" },
  { heading: "Lifespan", fieldKey: "lifespan", confidence: "high" },
  { heading: "Variation", fieldKey: "variation", confidence: "high" },
  { heading: "Habitat", fieldKey: "habitat", confidence: "high" },
  { heading: "Traits", fieldKey: "traits", confidence: "high" },
  { heading: "People", fieldKey: "people", confidence: "high" },
  { heading: "Values", fieldKey: "values", confidence: "high" },
  { heading: "Customs", fieldKey: "customs", confidence: "high" },
  { heading: "Etiquette", fieldKey: "etiquette", confidence: "high" },
  { heading: "Social structures", fieldKey: "socialStructures", confidence: "high" },
  { heading: "Regional variation", fieldKey: "regionalVariation", confidence: "high" },
  { heading: "Beliefs", fieldKey: "beliefs", confidence: "high" },
  { heading: "Denominations", fieldKey: "denominations", confidence: "high" },
  { heading: "Rituals", fieldKey: "rituals", confidence: "high" },
  { heading: "Sacred places", fieldKey: "sacredPlaces", confidence: "high" },
  { heading: "Internal disputes", fieldKey: "internalDisputes", confidence: "high" },
  { heading: "Purpose", fieldKey: "goal", confidence: "high" },
  { heading: "Goal", fieldKey: "goal", confidence: "high" },
  { heading: "Leadership", fieldKey: "leadershipStructure", confidence: "high" },
  { heading: "Leadership structure", fieldKey: "leadershipStructure", confidence: "high" },
  { heading: "Membership", fieldKey: "membership", confidence: "high" },
  { heading: "Admission requirements", fieldKey: "admissionRequirements", confidence: "high" },
  { heading: "Apprenticeship stages", fieldKey: "apprenticeshipStages", confidence: "high" },
  { heading: "Credentials issued", fieldKey: "credentialsIssued", confidence: "high" },
  { heading: "Ritual occasion", fieldKey: "ritualOccasion", confidence: "high" },
  { heading: "Participant roles", fieldKey: "participantRoles", confidence: "high" },
  { heading: "Ritual steps", fieldKey: "ritualSteps", confidence: "high" },
  { heading: "Ritual variations", fieldKey: "ritualVariations", confidence: "high" },
  { heading: "Parent language", fieldKey: "parentLanguage", confidence: "high" },
  { heading: "Regional sound changes", fieldKey: "regionalSoundChanges", confidence: "high" },
  { heading: "Distinctive expressions", fieldKey: "distinctiveExpressions", confidence: "high" },
  { heading: "Example lines", fieldKey: "exampleLines", confidence: "high" },
  { heading: "Resources", fieldKey: "resources", confidence: "high" },
  { heading: "Influence", fieldKey: "influence", confidence: "high" },
  { heading: "Headquarters", fieldKey: "headquarters", confidence: "high" },
  { heading: "Speakers", fieldKey: "speakers", confidence: "high" },
  { heading: "Writing", fieldKey: "writing", confidence: "high" },
  { heading: "Writing system", fieldKey: "writing", confidence: "high" },
  { heading: "Pronunciation", fieldKey: "pronunciation", confidence: "high" },
  { heading: "Grammar", fieldKey: "grammar", confidence: "high" },
  { heading: "Naming conventions", fieldKey: "namingConventions", confidence: "high" },
  { heading: "Period", fieldKey: "period", confidence: "high" },
  { heading: "Date", fieldKey: "date", confidence: "high" },
  { heading: "Participants", fieldKey: "participants", confidence: "high" },
  { heading: "Causes", fieldKey: "causes", confidence: "high" },
  { heading: "Consequences", fieldKey: "consequences", confidence: "high" },
  { heading: "Timeline", fieldKey: "timelineEvents", confidence: "medium" },
  { heading: "History", fieldKey: "consequences", confidence: "medium" },
  { heading: "Currencies", fieldKey: "currencies", confidence: "high" },
  { heading: "Trade", fieldKey: "trade", confidence: "high" },
  { heading: "Professions", fieldKey: "professions", confidence: "high" },
  { heading: "Economic pressures", fieldKey: "economicPressures", confidence: "high" },
  { heading: "Operating requirements", fieldKey: "operatingRequirements", confidence: "high" },
  { heading: "Availability", fieldKey: "availability", confidence: "high" },
  { heading: "Limitations", fieldKey: "limitations", confidence: "high" },
  { heading: "Origin", fieldKey: "origin", confidence: "high" },
  { heading: "Appearance", fieldKey: "appearance", confidence: "high" },
  { heading: "Function", fieldKey: "function", confidence: "high" },
  { heading: "Ownership", fieldKey: "ownership", confidence: "high" },
  { heading: "Significance", fieldKey: "significance", confidence: "high" },
  { heading: "Current holder", fieldKey: "keeper", confidence: "high" },
  { heading: "Use", fieldKey: "keeper", confidence: "low" },
  { heading: "Jurisdiction", fieldKey: "jurisdiction", confidence: "high" },
  { heading: "Provisions", fieldKey: "provisions", confidence: "high" },
  { heading: "Enforcement", fieldKey: "enforcement", confidence: "high" },
  { heading: "Affected groups", fieldKey: "affectedGroups", confidence: "high" },
  { heading: "Open questions", fieldKey: "openQuestions", confidence: "medium" },
];

export interface WorldUpgradeItem {
  id: string;
  fieldPath: string;
  storage: "flat" | "profile" | "summary" | "hold";
  proposedValue: string;
  sourceHeading: string;
  sourceText: string;
  sourceExcerpt: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
  existingCanonical: string;
  existingAuthority: AuthorityStatus;
  conflictWithIds: string[];
  authorityHint: AuthorityStatus | "ambiguous";
  requiresHumanReview: boolean;
  reviewReasons: string[];
  classificationConfidence: WorldUpgradeConfidence;
  alreadyApplied: boolean;
  mergeSupported: boolean;
}

export interface WorldUpgradeAnalysis {
  bodyHash: string;
  sections: MarkdownSection[];
  items: WorldUpgradeItem[];
  unclassifiedHeadings: string[];
  fingerprint: string;
}

export interface WorldUpgradeDecisionInput {
  itemId: string;
  decision: WorldUpgradeDecision;
  modifiedValue?: string;
}

export interface WorldMarkdownArchiveEntry {
  id: string;
  body: string;
  bodyHash: string;
  sourceRevision: number;
  archivedAt: string;
  migrationFingerprint: string;
}

export interface WorldMarkdownArchive {
  version: typeof WORLD_MARKDOWN_ARCHIVE_VERSION;
  entries: WorldMarkdownArchiveEntry[];
  appliedFingerprints: string[];
}

export interface WorldArchiveReadResult {
  archive: WorldMarkdownArchive;
  problems: Array<{ path: string; message: string }>;
  unsupportedVersion: boolean;
}

export interface ApplyWorldUpgradeResult {
  profile: WorldProfile;
  flatFieldUpdates: Record<string, string>;
  archive: WorldMarkdownArchive;
  fields: JsonObject;
  appliedItemIds: string[];
  deferredItemIds: string[];
  rejectedItemIds: string[];
  noEffectiveChange: boolean;
}

const SUPERSEDE_RE =
  /\b(supersedes?|replaces?|no longer|formerly|was previously|amendment|updated to|retcon)\b/i;
const PLANNED_RE =
  /\b(will (eventually|later|soon)|plans? to|intended to|eventually|future|planned)\b/i;
const MYSTERY_RE =
  /\b(unknown|mystery|unresolved|do not (resolve|reveal)|protected mystery|leave blank)\b/i;
const PROPOSED_RE = /\b(proposed|draft only|not canon|unapproved|maybe|consider)\b/i;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeHeading(title: string): string {
  return title.normalize("NFC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function excerptOf(value: string, max = 160): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function emptyArchive(): WorldMarkdownArchive {
  return { version: WORLD_MARKDOWN_ARCHIVE_VERSION, entries: [], appliedFingerprints: [] };
}

export function emptyWorldMarkdownArchive(): WorldMarkdownArchive {
  return emptyArchive();
}

export function readWorldMarkdownArchive(fields: Readonly<Record<string, unknown>>): WorldMarkdownArchive {
  return readWorldMarkdownArchiveWithStatus(fields).archive;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readWorldMarkdownArchiveWithStatus(fields: Readonly<Record<string, unknown>>): WorldArchiveReadResult {
  const problems: Array<{ path: string; message: string }> = [];
  const raw = fields[WORLD_MARKDOWN_ARCHIVE_KEY];
  if (raw === undefined || raw === null) {
    return { archive: emptyArchive(), problems, unsupportedVersion: false };
  }
  const row = asRecord(raw);
  if (!row) {
    problems.push({ path: WORLD_MARKDOWN_ARCHIVE_KEY, message: "World Markdown archive is not an object." });
    return { archive: emptyArchive(), problems, unsupportedVersion: false };
  }
  if (row.version !== undefined && row.version !== WORLD_MARKDOWN_ARCHIVE_VERSION) {
    problems.push({
      path: `${WORLD_MARKDOWN_ARCHIVE_KEY}.version`,
      message: "This world Markdown archive version is not supported.",
    });
    return { archive: emptyArchive(), problems, unsupportedVersion: true };
  }
  const entries: WorldMarkdownArchiveEntry[] = [];
  if (Array.isArray(row.entries)) {
    for (const item of row.entries) {
      const entry = asRecord(item);
      if (!entry) continue;
      const body = typeof entry.body === "string" ? entry.body : "";
      const bodyHash = typeof entry.bodyHash === "string" ? entry.bodyHash : "";
      const id = typeof entry.id === "string" ? entry.id : newId("wma");
      if (!body && !bodyHash) continue;
      entries.push({
        id,
        body,
        bodyHash,
        sourceRevision: typeof entry.sourceRevision === "number" ? entry.sourceRevision : 0,
        archivedAt: typeof entry.archivedAt === "string" ? entry.archivedAt : new Date(0).toISOString(),
        migrationFingerprint: typeof entry.migrationFingerprint === "string" ? entry.migrationFingerprint : "",
      });
    }
  }
  const appliedFingerprints = Array.isArray(row.appliedFingerprints)
    ? row.appliedFingerprints.filter((item): item is string => typeof item === "string")
    : [];
  return {
    archive: { version: WORLD_MARKDOWN_ARCHIVE_VERSION, entries, appliedFingerprints },
    problems,
    unsupportedVersion: false,
  };
}

export function worldMarkdownArchiveWriteProblems(value: unknown): Array<{ path: string; message: string }> {
  if (value === undefined || value === null) return [];
  const row = asRecord(value);
  if (!row) return [{ path: WORLD_MARKDOWN_ARCHIVE_KEY, message: "World Markdown archive is not an object." }];
  if (row.version !== undefined && row.version !== WORLD_MARKDOWN_ARCHIVE_VERSION) {
    return [{ path: `${WORLD_MARKDOWN_ARCHIVE_KEY}.version`, message: "This world Markdown archive version is not supported." }];
  }
  if (row.version === undefined) {
    return [{ path: `${WORLD_MARKDOWN_ARCHIVE_KEY}.version`, message: "World Markdown archive needs version 1." }];
  }
  return readWorldMarkdownArchiveWithStatus({ [WORLD_MARKDOWN_ARCHIVE_KEY]: value }).problems;
}

export function withWorldMarkdownArchive(fields: JsonObject, archive: WorldMarkdownArchive): JsonObject {
  return {
    ...fields,
    [WORLD_MARKDOWN_ARCHIVE_KEY]: JSON.parse(JSON.stringify(archive)) as JsonObject,
  };
}

function findFieldDef(definition: WorldProfileDefinition | null, key: string): WorldProfileFieldDef | null {
  return definition?.fields.find((field) => field.key === key) ?? null;
}

function existingValueText(
  profile: WorldProfile,
  flatFields: Readonly<Record<string, unknown>>,
  fieldKey: string,
  storage: WorldUpgradeItem["storage"],
): string {
  if (storage === "summary") return profile.summary ?? "";
  if (storage === "flat") {
    const raw = flatFields[fieldKey];
    return typeof raw === "string" ? raw : formatWorldProfileFieldValue(raw as never);
  }
  if (storage === "profile") {
    return formatWorldProfileFieldValue(profile.values[fieldKey] ?? null);
  }
  return "";
}

function resolveStorage(
  definition: WorldProfileDefinition | null,
  fieldKey: string,
): WorldUpgradeItem["storage"] {
  if (fieldKey === "summary") return "summary";
  const def = findFieldDef(definition, fieldKey);
  if (def) return def.storage;
  if (definition?.kindKey && WORLD_KIND_FIELD_SPECS[definition.kindKey].some((s) => s.key === fieldKey)) {
    return "flat";
  }
  for (const kind of Object.keys(WORLD_KIND_FIELD_SPECS)) {
    if (!isWorldKindKey(kind)) continue;
    if (WORLD_KIND_FIELD_SPECS[kind].some((s) => s.key === fieldKey)) return "flat";
  }
  return "profile";
}

function labelLineExtractions(sectionBody: string): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const line of sectionBody.split(/\r?\n/)) {
    const match = /^\s*\*{0,2}([A-Za-z][A-Za-z0-9 /_-]{0,60})\*{0,2}\s*[:：]\s*(.+)\s*$/.exec(line);
    if (!match) continue;
    out.push({ label: match[1]!.trim(), value: match[2]!.trim() });
  }
  return out;
}

function mapHeadingToField(
  heading: string,
  definition: WorldProfileDefinition | null,
): { fieldKey: string; confidence: WorldUpgradeConfidence } | null {
  const want = normalizeHeading(heading);
  for (const field of definition?.fields ?? []) {
    if (normalizeHeading(field.label) === want || normalizeHeading(field.key) === want) {
      return { fieldKey: field.key, confidence: "high" };
    }
  }
  const definitionKeys = new Set((definition?.fields ?? []).map((field) => field.key));
  for (const mapping of WORLD_HEADING_MAP) {
    if (normalizeHeading(mapping.heading) !== want) continue;
    if (mapping.fieldKey === "summary") {
      return { fieldKey: mapping.fieldKey, confidence: mapping.confidence };
    }
    // Prefer unambiguous mappings that the active definition actually owns.
    if (definition && !definitionKeys.has(mapping.fieldKey)) continue;
    if (!definition && mapping.confidence === "low") continue;
    return { fieldKey: mapping.fieldKey, confidence: mapping.confidence };
  }
  return null;
}

export function analyzeWorldProfileUpgrade(
  body: string,
  profile: WorldProfile,
  flatFields: Readonly<Record<string, unknown>>,
  definition: WorldProfileDefinition | null,
): WorldUpgradeAnalysis {
  const sections = parseMarkdownSections(body);
  const bodyHash = sha256(body);
  const items: WorldUpgradeItem[] = [];
  const unclassifiedHeadings: string[] = [];
  const usedFieldKeys = new Set<string>();

  for (const section of sections) {
    const heading = section.cleanHeading || section.heading;
    const mapped = mapHeadingToField(heading, definition);
    const sectionText = section.body.trim();
    if (!sectionText) continue;
    if (!mapped) {
      unclassifiedHeadings.push(heading);
      const holdId = `wup_${items.length}_hold`;
      items.push({
        id: holdId,
        fieldPath: "migrationHold.unclassified",
        storage: "hold",
        proposedValue: sectionText,
        sourceHeading: heading,
        sourceText: sectionText,
        sourceExcerpt: excerptOf(sectionText),
        sourceStartOffset: section.startOffset,
        sourceEndOffset: section.endOffset,
        existingCanonical: "",
        existingAuthority: "draft",
        conflictWithIds: [],
        authorityHint: MYSTERY_RE.test(sectionText)
          ? "unresolved"
          : PROPOSED_RE.test(sectionText)
            ? "proposed"
            : "draft",
        requiresHumanReview: true,
        reviewReasons: ["Unclassified heading"],
        classificationConfidence: "low",
        alreadyApplied: false,
        mergeSupported: false,
      });
      continue;
    }

    const storage = resolveStorage(definition, mapped.fieldKey);
    const existing = existingValueText(profile, flatFields, mapped.fieldKey, storage);
    const meta = worldFieldMetaOf(profile, storage === "flat" ? `fields.${mapped.fieldKey}` : mapped.fieldKey === "summary" ? "summary" : `values.${mapped.fieldKey}`);
    const reasons: string[] = [];
    if (SUPERSEDE_RE.test(sectionText)) reasons.push("Possible superseding amendment");
    if (PLANNED_RE.test(sectionText)) reasons.push("Looks planned / future");
    if (MYSTERY_RE.test(sectionText)) reasons.push("Protected unknown / mystery");
    if (PROPOSED_RE.test(sectionText)) reasons.push("Marked proposed / not canon");
    if (existing.trim() && normalizeText(existing) !== normalizeText(sectionText)) {
      reasons.push("Conflicts with existing value");
    }
    if (meta.approval === "approved" && existing.trim()) reasons.push("Existing approved canon");

    const alreadyApplied =
      existing.trim().length > 0 && normalizeText(existing) === normalizeText(sectionText);
    usedFieldKeys.add(mapped.fieldKey);
    items.push({
      id: `wup_${items.length}_${mapped.fieldKey}`,
      fieldPath: mapped.fieldKey,
      storage,
      proposedValue: sectionText,
      sourceHeading: heading,
      sourceText: sectionText,
      sourceExcerpt: excerptOf(sectionText),
      sourceStartOffset: section.startOffset,
      sourceEndOffset: section.endOffset,
      existingCanonical: existing,
      existingAuthority: meta.approval,
      conflictWithIds: [],
      authorityHint: MYSTERY_RE.test(sectionText)
        ? "unresolved"
        : PROPOSED_RE.test(sectionText)
          ? "proposed"
          : "draft",
      requiresHumanReview: reasons.length > 0,
      reviewReasons: reasons,
      classificationConfidence: mapped.confidence,
      alreadyApplied,
      mergeSupported: Boolean(existing.trim()) && storage !== "hold",
    });

    for (const line of labelLineExtractions(sectionText)) {
      const lineMap = mapHeadingToField(line.label, definition);
      if (!lineMap || usedFieldKeys.has(lineMap.fieldKey)) continue;
      const lineStorage = resolveStorage(definition, lineMap.fieldKey);
      const lineExisting = existingValueText(profile, flatFields, lineMap.fieldKey, lineStorage);
      const lineMeta = worldFieldMetaOf(
        profile,
        lineStorage === "flat" ? `fields.${lineMap.fieldKey}` : `values.${lineMap.fieldKey}`,
      );
      const lineReasons: string[] = [];
      if (lineExisting.trim() && normalizeText(lineExisting) !== normalizeText(line.value)) {
        lineReasons.push("Conflicts with existing value");
      }
      if (lineMeta.approval === "approved" && lineExisting.trim()) lineReasons.push("Existing approved canon");
      usedFieldKeys.add(lineMap.fieldKey);
      items.push({
        id: `wup_${items.length}_${lineMap.fieldKey}`,
        fieldPath: lineMap.fieldKey,
        storage: lineStorage,
        proposedValue: line.value,
        sourceHeading: `${heading} / ${line.label}`,
        sourceText: line.value,
        sourceExcerpt: excerptOf(line.value),
        sourceStartOffset: section.startOffset,
        sourceEndOffset: section.endOffset,
        existingCanonical: lineExisting,
        existingAuthority: lineMeta.approval,
        conflictWithIds: [],
        authorityHint: "draft",
        requiresHumanReview: lineReasons.length > 0,
        reviewReasons: lineReasons,
        classificationConfidence: "medium",
        alreadyApplied: Boolean(lineExisting.trim()) && normalizeText(lineExisting) === normalizeText(line.value),
        mergeSupported: Boolean(lineExisting.trim()),
      });
    }
  }

  const fingerprint = sha256(
    stableStringify({
      bodyHash,
      definitionId: definition?.id ?? null,
      items: items.map((item) => ({
        fieldPath: item.fieldPath,
        proposedValue: item.proposedValue,
        sourceHeading: item.sourceHeading,
      })),
    }),
  );

  return { bodyHash, sections, items, unclassifiedHeadings, fingerprint };
}

export function isWorldUpgradeDecision(value: string): value is WorldUpgradeDecision {
  return (WORLD_UPGRADE_DECISIONS as readonly string[]).includes(value);
}

export function upgradePreviewToken(input: {
  recordId: string;
  revision: number;
  bodyHash: string;
  fingerprint: string;
  archiveVersion: number;
}): string {
  return sha256(stableStringify(input));
}

export function upgradeDecisionFingerprint(decisions: readonly WorldUpgradeDecisionInput[]): string {
  return sha256(stableStringify(decisions));
}

export function decisionsRequireExplicitConflictChoice(
  analysis: WorldUpgradeAnalysis,
  decisions: readonly WorldUpgradeDecisionInput[],
): string[] {
  const byId = new Map(decisions.map((d) => [d.itemId, d]));
  const blocked: string[] = [];
  for (const item of analysis.items) {
    if (item.existingAuthority !== "approved" || !item.existingCanonical.trim()) continue;
    if (normalizeText(item.existingCanonical) === normalizeText(item.proposedValue)) continue;
    const decision = byId.get(item.id)?.decision ?? "defer";
    if (decision === "accept" || decision === "merge" || decision === "modify") {
      // Explicit choice is present; allowed.
      continue;
    }
    if (decision === "defer" || decision === "reject" || decision === "keep_existing") continue;
    blocked.push(item.id);
  }
  return blocked;
}

function mergeText(existing: string, proposed: string): string {
  if (!existing.trim()) return proposed;
  if (!proposed.trim()) return existing;
  if (normalizeText(existing) === normalizeText(proposed)) return existing;
  return `${existing.trim()}\n\n${proposed.trim()}`;
}

function applyValue(
  profile: WorldProfile,
  flatUpdates: Record<string, string>,
  item: WorldUpgradeItem,
  value: string,
): WorldProfile {
  let next = profile;
  if (item.storage === "summary") {
    next = { ...next, summary: value };
  } else if (item.storage === "flat") {
    flatUpdates[item.fieldPath] = value;
  } else if (item.storage === "profile") {
    next = {
      ...next,
      values: { ...next.values, [item.fieldPath]: value as WorldProfileFieldValue },
    };
  } else if (item.storage === "hold") {
    const hold: WorldMigrationHoldItem = {
      id: newId("wmh"),
      kind: "unclassified",
      fieldPath: item.fieldPath,
      heading: item.sourceHeading,
      text: value,
      sourceText: item.sourceText,
      note: "Held from Markdown upgrade",
      decision: "retained",
    };
    next = { ...next, migrationHold: [...next.migrationHold, hold] };
  }
  const metaPath =
    item.storage === "flat"
      ? `fields.${item.fieldPath}`
      : item.storage === "summary"
        ? "summary"
        : item.storage === "profile"
          ? `values.${item.fieldPath}`
          : item.fieldPath;
  if (item.storage !== "hold") {
    next = setWorldFieldMeta(next, metaPath, {
      approval: "draft",
      provenance: {
        origin: "extracted",
        note: "Accepted from Markdown upgrade",
        sourceHeading: item.sourceHeading,
        updatedAt: new Date().toISOString(),
        sourceRefs: [
          {
            excerpt: item.sourceExcerpt,
            startOffset: item.sourceStartOffset,
            endOffset: item.sourceEndOffset,
            heading: item.sourceHeading,
          },
        ],
      },
    });
  }
  return next;
}

export function applyWorldUpgradeDecisions(input: {
  body: string;
  profile: WorldProfile;
  flatFields: JsonObject;
  definition: WorldProfileDefinition | null;
  analysis: WorldUpgradeAnalysis;
  decisions: readonly WorldUpgradeDecisionInput[];
  archive: WorldMarkdownArchive;
  sourceRevision: number;
}): ApplyWorldUpgradeResult {
  const byId = new Map(input.decisions.map((d) => [d.itemId, d]));
  let profile = { ...input.profile, values: { ...input.profile.values }, collections: { ...input.profile.collections }, fieldMeta: { ...input.profile.fieldMeta }, migrationHold: [...input.profile.migrationHold] };
  const flatFieldUpdates: Record<string, string> = {};
  const appliedItemIds: string[] = [];
  const deferredItemIds: string[] = [];
  const rejectedItemIds: string[] = [];

  for (const item of input.analysis.items) {
    const decision = byId.get(item.id)?.decision ?? "defer";
    const modified = byId.get(item.id)?.modifiedValue;
    if (decision === "defer") {
      deferredItemIds.push(item.id);
      if (item.storage === "hold" || item.requiresHumanReview) {
        profile = {
          ...profile,
          migrationHold: [
            ...profile.migrationHold,
            {
              id: newId("wmh"),
              kind: item.authorityHint === "unresolved" ? "protected_unknowns" : item.conflictWithIds.length || item.existingCanonical ? "conflict" : "unclassified",
              fieldPath: item.fieldPath,
              heading: item.sourceHeading,
              text: item.proposedValue,
              sourceText: item.sourceText,
              note: item.reviewReasons.join("; ") || "Deferred during upgrade",
              decision: "deferred",
            },
          ],
        };
      }
      continue;
    }
    if (decision === "reject") {
      rejectedItemIds.push(item.id);
      continue;
    }
    if (decision === "keep_existing") {
      appliedItemIds.push(item.id);
      continue;
    }
    if (item.existingAuthority === "approved" && item.existingCanonical.trim() && decision === "accept") {
      // Explicit accept of overwrite is allowed only through modify/merge/accept with review —
      // still never auto-promote to approved.
    }
    let nextValue = item.proposedValue;
    if (decision === "modify") nextValue = (modified ?? item.proposedValue).trim();
    if (decision === "merge") nextValue = mergeText(item.existingCanonical, item.proposedValue);
    profile = applyValue(profile, flatFieldUpdates, item, nextValue);
    appliedItemIds.push(item.id);
  }

  const archiveEntry: WorldMarkdownArchiveEntry = {
    id: newId("wma"),
    body: input.body,
    bodyHash: input.analysis.bodyHash,
    sourceRevision: input.sourceRevision,
    archivedAt: new Date().toISOString(),
    migrationFingerprint: input.analysis.fingerprint,
  };
  const archive: WorldMarkdownArchive = {
    version: WORLD_MARKDOWN_ARCHIVE_VERSION,
    entries: [...input.archive.entries, archiveEntry].slice(-20),
    appliedFingerprints: input.archive.appliedFingerprints.includes(input.analysis.fingerprint)
      ? input.archive.appliedFingerprints
      : [...input.archive.appliedFingerprints, input.analysis.fingerprint],
  };

  let fields = withWorldProfile(input.flatFields, profile);
  fields = withWorldMarkdownArchive(fields, archive);
  for (const [key, value] of Object.entries(flatFieldUpdates)) {
    if (value.trim()) fields[key] = value;
    else delete fields[key];
  }

  const noEffectiveChange =
    appliedItemIds.length === 0 &&
    rejectedItemIds.length === 0 &&
    deferredItemIds.length === input.analysis.items.length;

  return {
    profile,
    flatFieldUpdates,
    archive,
    fields,
    appliedItemIds,
    deferredItemIds,
    rejectedItemIds,
    noEffectiveChange,
  };
}

export function fieldsAfterWorldUpgrade(
  fields: JsonObject,
  result: ApplyWorldUpgradeResult,
): JsonObject {
  return result.fields;
}

export function buildWorldUpgradeChangePackage(input: {
  workspaceId: string;
  projectId: string;
  recordId: string;
  expectedRevision: number;
  packageId: string;
  fields: JsonObject;
}): ChangePackageV1 {
  return {
    format: CHANGE_PACKAGE_FORMAT,
    formatVersion: CHANGE_PACKAGE_FORMAT_VERSION,
    packageId: input.packageId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    summary: "Worldbuilding Markdown upgrade into Living World Profile fields.",
    approval: {
      status: "proposed",
      statement: "Author-reviewed Living World Profile migration. Not auto-approved canon.",
    },
    scope: "reference",
    protectedOverrides: [],
    source: { conversationLabel: "World profile Markdown upgrade" },
    operations: [
      {
        op: "update_record",
        recordId: input.recordId,
        expectedRevision: input.expectedRevision,
        changes: {
          fields: { set: input.fields },
        },
        note: "Worldbuilding Markdown upgrade into Living World Profile fields.",
      },
    ],
    relatedRecords: [{ recordId: input.recordId, note: "World reference being upgraded." }],
  };
}

export function analyzeImportedWorldMarkdown(
  markdown: string,
  profile?: WorldProfile,
  flatFields: Readonly<Record<string, unknown>> = {},
  definition: WorldProfileDefinition | null = null,
): WorldUpgradeAnalysis {
  return analyzeWorldProfileUpgrade(markdown, profile ?? emptyWorldProfile(), flatFields, definition);
}

export { parseMarkdownSections, readWorldProfile };
