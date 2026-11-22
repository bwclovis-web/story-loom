/**
 * Author-reviewed migration from Markdown character dossiers into Living
 * Character Profiles (`fields.characterDevelopment`). Pure analysis and
 * merge helpers — nothing here writes the database. Authority stays with the
 * author: proposals never become approved canon automatically, mysteries stay
 * unresolved, and unclassified or conflicting text is kept for review.
 */

import {
  ARCHETYPE_LIBRARY,
  ARCHETYPE_RANKS,
  BEHAVIOR_TEXT_KEYS,
  CAPABILITIES_TEXT_KEYS,
  CHARACTER_DEVELOPMENT_KEY,
  emptyCharacterDevelopment,
  ENNEAGRAM_TYPES,
  fieldMetaOf,
  FOUNDATION_TEXT_KEYS,
  LIVED_EXPERIENCE_TEXT_KEYS,
  NARRATIVE_ROLES,
  PSYCHOLOGY_TEXT_KEYS,
  VOICE_TEXT_KEYS,
  wingIsValid,
  withCharacterDevelopment,
  type ArchetypeAssignment,
  type ArchetypeRank,
  type BehaviorTextKey,
  type CapabilitiesTextKey,
  type CharacterDevelopment,
  type EnneagramChoice,
  type EnneagramNumber,
  type FieldAuthorityMeta,
  type FoundationTextKey,
  type LivedExperienceTextKey,
  type MigrationHoldItem,
  type NarrativeRole,
  type PsychologyTextKey,
  type VoiceTextKey,
} from "@/domain/characterDevelopment";
import {
  CHARACTER_HEADING_MAP,
  findHeadingMapping,
  parseMarkdownSections,
  type MarkdownSection,
  type UpgradeConfidence,
  type UpgradeDestination,
} from "@/domain/characterHeadingExtraction";
import { newId } from "@/domain/ids";
import type { JsonObject } from "@/domain/json";
import { sha256, stableStringify } from "@/domain/json";
import type { AuthorityStatus } from "@/domain/statuses";
import {
  CHANGE_PACKAGE_FORMAT,
  CHANGE_PACKAGE_FORMAT_VERSION,
  type ChangePackageV1,
} from "@/changePackage/schema.v1";

export type { MarkdownSection, UpgradeConfidence, UpgradeDestination };
export { parseMarkdownSections, CHARACTER_HEADING_MAP as UPGRADE_HEADING_MAP };

export const DOSSIER_MARKDOWN_ARCHIVE_KEY = "dossierMarkdownArchive";
export const DOSSIER_MARKDOWN_ARCHIVE_VERSION = 1 as const;

export const UPGRADE_DESTINATIONS = [
  "identity",
  "psychology",
  "voice",
  "behavior",
  "lived",
  "relationships",
  "capabilities",
  "development",
  "continuity",
  "historical_amendments",
  "protected_unknowns",
  "proposed_unapproved",
  "unclassified",
] as const;

export const UPGRADE_DECISIONS = [
  "accept",
  "keep_existing",
  "merge",
  "modify",
  "reject",
  "defer",
] as const;
export type UpgradeDecision = (typeof UPGRADE_DECISIONS)[number];

export interface DossierUpgradeItem {
  id: string;
  destination: UpgradeDestination;
  fieldPath: string;
  proposedValue: string;
  sourceHeading: string;
  sourceText: string;
  sourceExcerpt: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
  existingCanonical: string;
  existingAuthority: AuthorityStatus;
  conflictWithIds: string[];
  supersedesIds: string[];
  supersededByIds: string[];
  authorityHint: AuthorityStatus | "ambiguous";
  requiresHumanReview: boolean;
  reviewReasons: string[];
  classificationConfidence: UpgradeConfidence;
  alreadyApplied: boolean;
  duplicateOfIds: string[];
  mergeSupported: boolean;
}

export interface DossierUpgradeAnalysis {
  bodyHash: string;
  sections: MarkdownSection[];
  items: DossierUpgradeItem[];
  unclassifiedHeadings: string[];
  fingerprint: string;
}

export interface DossierUpgradeDecisionInput {
  itemId: string;
  decision: UpgradeDecision;
  /** Used when decision is modify. */
  modifiedValue?: string;
}

export interface DossierMarkdownArchiveEntry {
  id: string;
  body: string;
  bodyHash: string;
  sourceRevision: number;
  archivedAt: string;
  migrationFingerprint: string;
}

export interface DossierMarkdownArchive {
  version: typeof DOSSIER_MARKDOWN_ARCHIVE_VERSION;
  entries: DossierMarkdownArchiveEntry[];
  appliedFingerprints: string[];
}

export interface ArchiveReadResult {
  archive: DossierMarkdownArchive;
  problems: Array<{ path: string; message: string }>;
  unsupportedVersion: boolean;
}

export interface ApplyUpgradeResult {
  profile: CharacterDevelopment;
  archive: DossierMarkdownArchive;
  fields: JsonObject;
  appliedItemIds: string[];
  deferredItemIds: string[];
  rejectedItemIds: string[];
  noEffectiveChange: boolean;
}

const SUPERSEDE_RE =
  /\b(supersedes?|replaces?|no longer|formerly|was previously|amendment|updated to|retcon)\b/i;
const PLANNED_RE =
  /\b(will (eventually|later|soon)|plans? to|intended to|eventually|future arc|planned growth|not yet)\b/i;
const MYSTERY_RE =
  /\b(unknown|mystery|unresolved|do not (resolve|reveal)|protected mystery|leave blank)\b/i;
const PROPOSED_RE = /\b(proposed|draft only|not canon|unapproved|maybe|consider)\b/i;

const STRUCTURED_CONFLICT_PREFIXES = [
  "foundation.",
  "psychology.",
  "voice.",
  "behavior.",
  "capabilities.",
  "livedExperience.",
] as const;

const STRUCTURED_EXACT_PATHS = ["narrativeRole", "archetypes", "psychology.enneagram"] as const;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function excerptOf(value: string, max = 160): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function summarizeArchetypes(archetypes: readonly ArchetypeAssignment[]): string {
  return archetypes
    .map((item) => {
      const period = item.periodLabel ? ` (${item.periodLabel})` : "";
      return `${item.rank}: ${item.name}${period}`.trim();
    })
    .join("\n");
}

function existingAtPath(profile: CharacterDevelopment, fieldPath: string): string {
  if (fieldPath === "narrativeRole") return profile.narrativeRole ?? "";
  if (fieldPath === "archetypes") return summarizeArchetypes(profile.archetypes);
  if (fieldPath === "psychology.enneagram") {
    if (profile.psychology.enneagram === null) return "";
    return profile.psychology.wing
      ? `${profile.psychology.enneagram}w${profile.psychology.wing}`
      : String(profile.psychology.enneagram);
  }
  const [root, key] = fieldPath.split(".");
  if (!root || !key) return "";
  if (root === "foundation" && (FOUNDATION_TEXT_KEYS as readonly string[]).includes(key)) {
    return profile.foundation[key as FoundationTextKey];
  }
  if (root === "voice" && (VOICE_TEXT_KEYS as readonly string[]).includes(key)) {
    return profile.voice[key as VoiceTextKey];
  }
  if (root === "psychology" && (PSYCHOLOGY_TEXT_KEYS as readonly string[]).includes(key)) {
    return profile.psychology[key as PsychologyTextKey];
  }
  if (root === "behavior" && (BEHAVIOR_TEXT_KEYS as readonly string[]).includes(key)) {
    return profile.behavior[key as BehaviorTextKey];
  }
  if (root === "livedExperience" && (LIVED_EXPERIENCE_TEXT_KEYS as readonly string[]).includes(key)) {
    return profile.livedExperience[key as LivedExperienceTextKey];
  }
  if (root === "capabilities" && (CAPABILITIES_TEXT_KEYS as readonly string[]).includes(key)) {
    return profile.capabilities[key as CapabilitiesTextKey];
  }
  if (root === "hold") {
    const held = profile.migrationHold.filter(
      (item) => item.kind === holdKindForPath(fieldPath) || item.fieldPath === fieldPath,
    );
    return held.map((item) => item.text).join("\n\n");
  }
  return "";
}

function existingAuthorityAtPath(profile: CharacterDevelopment, fieldPath: string): AuthorityStatus {
  if (fieldPath === "archetypes") {
    if (profile.archetypes.some((item) => item.approval === "approved")) return "approved";
    if (profile.archetypes.some((item) => item.approval === "proposed")) return "proposed";
    return profile.archetypes.length ? "draft" : fieldMetaOf(profile, fieldPath).approval;
  }
  if (fieldPath === "psychology.enneagram" || fieldPath === "narrativeRole") {
    return fieldMetaOf(profile, fieldPath).approval;
  }
  return fieldMetaOf(profile, fieldPath).approval;
}

function holdKindForPath(fieldPath: string): MigrationHoldItem["kind"] {
  if (fieldPath.includes("unknown")) return "protected_unknowns";
  if (fieldPath.includes("proposed") || fieldPath.includes("development")) return "proposed_unapproved";
  if (fieldPath.includes("historical")) return "historical_amendments";
  if (fieldPath.includes("relationships")) return "relationships_notes";
  if (fieldPath.includes("continuity")) return "continuity_notes";
  return "unclassified";
}

function mapSection(
  section: MarkdownSection,
): { destination: UpgradeDestination; fieldPath: string; confidence: UpgradeConfidence } {
  const mapped = findHeadingMapping(section.cleanHeading);
  if (mapped) {
    return { destination: mapped.destination, fieldPath: mapped.fieldPath, confidence: mapped.confidence };
  }
  if (section.tags.some((tag) => /UNKNOWN|PROTECTED|UNRESOLVED/.test(tag))) {
    return { destination: "protected_unknowns", fieldPath: "hold.unknowns", confidence: "medium" };
  }
  if (section.tags.some((tag) => /PROPOSED|DRAFT/.test(tag))) {
    return { destination: "proposed_unapproved", fieldPath: "hold.proposed", confidence: "medium" };
  }
  if (MYSTERY_RE.test(section.cleanHeading) || MYSTERY_RE.test(section.body)) {
    return { destination: "protected_unknowns", fieldPath: "hold.unknowns", confidence: "low" };
  }
  if (PROPOSED_RE.test(section.cleanHeading)) {
    return { destination: "proposed_unapproved", fieldPath: "hold.proposed", confidence: "low" };
  }
  if (SUPERSEDE_RE.test(section.cleanHeading)) {
    return { destination: "historical_amendments", fieldPath: "hold.historical", confidence: "medium" };
  }
  return { destination: "unclassified", fieldPath: "hold.unclassified", confidence: "low" };
}

function authorityForSection(section: MarkdownSection, destination: UpgradeDestination): AuthorityStatus | "ambiguous" {
  const tagBlob = section.tags.join(" ");
  if (/APPROVED/.test(tagBlob)) return "approved";
  if (/SUPERSEDED/.test(tagBlob)) return "superseded";
  if (/UNRESOLVED|UNKNOWN|PROTECTED/.test(tagBlob)) return "unresolved";
  if (/PROPOSED|DRAFT|SELECTED/.test(tagBlob)) return "proposed";
  if (destination === "proposed_unapproved") return "proposed";
  if (destination === "protected_unknowns") return "unresolved";
  if (destination === "historical_amendments") return "superseded";
  if (destination === "unclassified") return "ambiguous";
  if (PLANNED_RE.test(section.body) && !SUPERSEDE_RE.test(section.body)) return "proposed";
  if (section.tags.length === 0 && (PROPOSED_RE.test(section.body) || MYSTERY_RE.test(section.body))) {
    return "ambiguous";
  }
  return "draft";
}

function itemId(destination: UpgradeDestination, fieldPath: string, sourceText: string, heading: string): string {
  return `upg_${sha256(`${destination}|${fieldPath}|${normalizeText(sourceText)}|${normalizeText(heading)}`).slice(0, 24)}`;
}

function isStructuredConflictPath(fieldPath: string): boolean {
  if ((STRUCTURED_EXACT_PATHS as readonly string[]).includes(fieldPath)) return true;
  return STRUCTURED_CONFLICT_PREFIXES.some((prefix) => fieldPath.startsWith(prefix));
}

function isInferredClassificationPath(fieldPath: string): boolean {
  return fieldPath === "psychology.enneagram" || fieldPath === "archetypes" || fieldPath === "narrativeRole";
}

function mergeSupportedForPath(fieldPath: string): boolean {
  return isStructuredConflictPath(fieldPath);
}

/**
 * Analyze Markdown into reviewable upgrade items. Does not invent facts, does
 * not approve canon, and keeps every section that cannot be classified.
 */
export function analyzeDossierUpgrade(body: string, profile: CharacterDevelopment): DossierUpgradeAnalysis {
  const sections = parseMarkdownSections(body);
  const bodyHash = sha256(body);
  const items: DossierUpgradeItem[] = [];
  const unclassifiedHeadings: string[] = [];

  for (const section of sections) {
    if (!section.body.trim()) continue;
    const mapped = mapSection(section);
    if (mapped.destination === "unclassified") unclassifiedHeadings.push(section.heading);

    const authorityHint = authorityForSection(section, mapped.destination);
    const existingCanonical = existingAtPath(profile, mapped.fieldPath);
    const existingAuthority = existingAuthorityAtPath(profile, mapped.fieldPath);
    const reviewReasons: string[] = [];
    let requiresHumanReview = false;

    if (isInferredClassificationPath(mapped.fieldPath)) {
      requiresHumanReview = true;
      reviewReasons.push("Inferred classification requires author approval.");
    }
    if (mapped.confidence === "low") {
      requiresHumanReview = true;
      reviewReasons.push("Classification confidence is low.");
    }
    if (authorityHint === "ambiguous") {
      requiresHumanReview = true;
      reviewReasons.push("Authority of this passage is ambiguous.");
    }
    if (authorityHint === "approved") {
      requiresHumanReview = true;
      reviewReasons.push("Marked approved in the Markdown; migration will not promote it to approved canon automatically.");
    }
    if (existingCanonical.trim() && normalizeText(existingCanonical) !== normalizeText(section.body)) {
      requiresHumanReview = true;
      reviewReasons.push("Existing profile content differs from this source passage.");
      if (existingAuthority === "approved") {
        reviewReasons.push("Existing content is approved canon; choose Keep existing, Replace, Merge, or Defer.");
      }
    }
    if (mapped.destination === "lived") {
      requiresHumanReview = true;
      reviewReasons.push("Lived-experience notes need explicit author acceptance.");
    }
    if (mapped.destination === "protected_unknowns") {
      requiresHumanReview = true;
      reviewReasons.push("Protected unknowns stay unresolved; migration will not fill them as facts.");
    }
    if (mapped.destination === "development" && PLANNED_RE.test(section.body)) {
      requiresHumanReview = true;
      reviewReasons.push("Planned growth is not treated as completed development.");
    }
    if (SUPERSEDE_RE.test(section.heading) || SUPERSEDE_RE.test(section.body)) {
      requiresHumanReview = true;
      reviewReasons.push("Amendment language detected; confirm what this supersedes.");
    }
    if (
      mapped.destination === "relationships" ||
      mapped.destination === "development" ||
      mapped.destination === "continuity"
    ) {
      requiresHumanReview = true;
      reviewReasons.push("This destination is held for review rather than written as approved structured fields.");
    }

    const alreadyApplied =
      (existingCanonical.trim() !== "" && normalizeText(existingCanonical) === normalizeText(section.body)) ||
      profile.migrationHold.some(
        (held) =>
          normalizeText(held.sourceText) === normalizeText(section.body) && held.fieldPath === mapped.fieldPath,
      );

    items.push({
      id: itemId(mapped.destination, mapped.fieldPath, section.body, section.heading),
      destination: mapped.destination,
      fieldPath: mapped.fieldPath,
      proposedValue: section.body,
      sourceHeading: section.heading,
      sourceText: section.body,
      sourceExcerpt: excerptOf(section.body),
      sourceStartOffset: section.startOffset,
      sourceEndOffset: section.endOffset,
      existingCanonical,
      existingAuthority,
      conflictWithIds: [],
      supersedesIds: [],
      supersededByIds: [],
      authorityHint,
      requiresHumanReview,
      reviewReasons,
      classificationConfidence: mapped.confidence,
      alreadyApplied,
      duplicateOfIds: [],
      mergeSupported: mergeSupportedForPath(mapped.fieldPath),
    });
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (normalizeText(a.sourceText) === normalizeText(b.sourceText)) {
        a.duplicateOfIds.push(b.id);
        b.duplicateOfIds.push(a.id);
        a.requiresHumanReview = true;
        b.requiresHumanReview = true;
        a.reviewReasons.push("Duplicate passage appears more than once.");
        b.reviewReasons.push("Duplicate passage appears more than once.");
      }
      if (
        a.fieldPath === b.fieldPath &&
        isStructuredConflictPath(a.fieldPath) &&
        normalizeText(a.proposedValue) !== normalizeText(b.proposedValue)
      ) {
        a.conflictWithIds.push(b.id);
        b.conflictWithIds.push(a.id);
        a.requiresHumanReview = true;
        b.requiresHumanReview = true;
        a.reviewReasons.push("Contradictory values map to the same field.");
        b.reviewReasons.push("Contradictory values map to the same field.");
      }
    }
  }

  for (let i = 0; i < items.length; i++) {
    const later = items[i]!;
    const section = sections.find((s) => s.startOffset === later.sourceStartOffset);
    if (!section) continue;
    if (!(SUPERSEDE_RE.test(section.heading) || SUPERSEDE_RE.test(section.body))) continue;
    for (let j = 0; j < i; j++) {
      const earlier = items[j]!;
      if (earlier.fieldPath === later.fieldPath || earlier.destination === later.destination) {
        later.supersedesIds.push(earlier.id);
        earlier.supersededByIds.push(later.id);
        earlier.requiresHumanReview = true;
        later.requiresHumanReview = true;
      }
    }
  }

  const fingerprint = sha256(
    stableStringify({
      bodyHash,
      items: items.map((item) => ({
        id: item.id,
        destination: item.destination,
        fieldPath: item.fieldPath,
        proposed: normalizeText(item.proposedValue),
        existing: normalizeText(item.existingCanonical),
        existingAuthority: item.existingAuthority,
      })),
    }),
  );

  return { bodyHash, sections, items, unclassifiedHeadings, fingerprint };
}

export function emptyDossierMarkdownArchive(): DossierMarkdownArchive {
  return { version: DOSSIER_MARKDOWN_ARCHIVE_VERSION, entries: [], appliedFingerprints: [] };
}

export function readDossierMarkdownArchive(fields: Readonly<Record<string, unknown>>): DossierMarkdownArchive {
  return readDossierMarkdownArchiveWithStatus(fields).archive;
}

export function readDossierMarkdownArchiveWithStatus(
  fields: Readonly<Record<string, unknown>>,
): ArchiveReadResult {
  const raw = fields[DOSSIER_MARKDOWN_ARCHIVE_KEY];
  if (raw === undefined || raw === null) {
    return { archive: emptyDossierMarkdownArchive(), problems: [], unsupportedVersion: false };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      archive: emptyDossierMarkdownArchive(),
      problems: [{ path: DOSSIER_MARKDOWN_ARCHIVE_KEY, message: "Dossier Markdown archive is not an object." }],
      unsupportedVersion: false,
    };
  }
  const row = raw as Record<string, unknown>;
  if (row.version !== undefined && row.version !== DOSSIER_MARKDOWN_ARCHIVE_VERSION) {
    return {
      archive: emptyDossierMarkdownArchive(),
      problems: [
        {
          path: "version",
          message: `This dossier Markdown archive version (${String(row.version)}) is not supported. The stored archive was left unread so it is not overwritten.`,
        },
      ],
      unsupportedVersion: true,
    };
  }
  const entries = Array.isArray(row.entries)
    ? row.entries.flatMap((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const entry = item as Record<string, unknown>;
        const body = typeof entry.body === "string" ? entry.body : "";
        const bodyHash = typeof entry.bodyHash === "string" ? entry.bodyHash : sha256(body);
        if (!body) return [];
        return [
          {
            id: typeof entry.id === "string" ? entry.id : `archive_${index}`,
            body,
            bodyHash,
            sourceRevision: typeof entry.sourceRevision === "number" ? entry.sourceRevision : 0,
            archivedAt: typeof entry.archivedAt === "string" ? entry.archivedAt : "",
            migrationFingerprint: typeof entry.migrationFingerprint === "string" ? entry.migrationFingerprint : "",
          },
        ];
      })
    : [];
  const appliedFingerprints = Array.isArray(row.appliedFingerprints)
    ? row.appliedFingerprints.filter((value): value is string => typeof value === "string")
    : [];
  return {
    archive: { version: DOSSIER_MARKDOWN_ARCHIVE_VERSION, entries, appliedFingerprints },
    problems: [],
    unsupportedVersion: false,
  };
}

/** Problems that block writing an archive object from a change package or upgrade. */
export function dossierMarkdownArchiveWriteProblems(value: unknown): Array<{ path: string; message: string }> {
  if (value === undefined || value === null) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ path: DOSSIER_MARKDOWN_ARCHIVE_KEY, message: "Dossier Markdown archive is not an object." }];
  }
  const row = value as Record<string, unknown>;
  if (row.version !== undefined && row.version !== DOSSIER_MARKDOWN_ARCHIVE_VERSION) {
    return [
      {
        path: "version",
        message: `This dossier Markdown archive version (${String(row.version)}) is not supported.`,
      },
    ];
  }
  return [];
}

export function withDossierMarkdownArchive(fields: JsonObject, archive: DossierMarkdownArchive): JsonObject {
  return { ...fields, [DOSSIER_MARKDOWN_ARCHIVE_KEY]: JSON.parse(JSON.stringify(archive)) as JsonObject };
}

export function appendArchiveEntry(
  archive: DossierMarkdownArchive,
  input: { body: string; sourceRevision: number; migrationFingerprint: string; archivedAt?: string },
): DossierMarkdownArchive {
  const bodyHash = sha256(input.body);
  if (archive.entries.some((entry) => entry.bodyHash === bodyHash)) {
    return {
      ...archive,
      appliedFingerprints: archive.appliedFingerprints.includes(input.migrationFingerprint)
        ? archive.appliedFingerprints
        : [...archive.appliedFingerprints, input.migrationFingerprint],
    };
  }
  return {
    version: DOSSIER_MARKDOWN_ARCHIVE_VERSION,
    entries: [
      ...archive.entries,
      {
        id: newId("rec").replace(/^rec_/, "darch_"),
        body: input.body,
        bodyHash,
        sourceRevision: input.sourceRevision,
        archivedAt: input.archivedAt ?? new Date().toISOString(),
        migrationFingerprint: input.migrationFingerprint,
      },
    ],
    appliedFingerprints: archive.appliedFingerprints.includes(input.migrationFingerprint)
      ? archive.appliedFingerprints
      : [...archive.appliedFingerprints, input.migrationFingerprint],
  };
}

function decisionMap(decisions: readonly DossierUpgradeDecisionInput[]): Map<string, DossierUpgradeDecisionInput> {
  const map = new Map<string, DossierUpgradeDecisionInput>();
  for (const decision of decisions) map.set(decision.itemId, decision);
  return map;
}

function importedMeta(
  item: DossierUpgradeItem,
  bodyHash: string,
  approval: AuthorityStatus,
): FieldAuthorityMeta {
  return {
    approval,
    provenance: {
      origin: "imported",
      note: "Accepted from dossier upgrade",
      sourceHeading: item.sourceHeading,
      sourceBodyHash: bodyHash,
      updatedAt: new Date().toISOString(),
    },
  };
}

function approvalFromHint(hint: AuthorityStatus | "ambiguous"): AuthorityStatus {
  if (hint === "proposed") return "proposed";
  if (hint === "unresolved") return "unresolved";
  if (hint === "superseded") return "superseded";
  // Never promote Markdown [APPROVED] or ambiguous tags to approved canon.
  return "draft";
}

function parseEnneagramValue(value: string): { enneagram: EnneagramChoice | null; wing: EnneagramNumber | null; leftover: string } {
  const trimmed = value.trim();
  const match = trimmed.match(/\b([1-9])\s*[wW]\s*([1-9])\b/) || trimmed.match(/\btype\s*([1-9])\b/i) || trimmed.match(/\b([1-9])\b/);
  if (!match) {
    const choice =
      /\bunknown\b/i.test(trimmed)
        ? ("unknown" as const)
        : /\bundecided\b/i.test(trimmed)
          ? ("undecided" as const)
          : /\bnot\s*applicable\b/i.test(trimmed)
            ? ("not_applicable" as const)
            : null;
    return { enneagram: choice, wing: null, leftover: choice ? "" : trimmed };
  }
  const type = Number(match[1]) as EnneagramNumber;
  if (!(ENNEAGRAM_TYPES as readonly number[]).includes(type)) {
    return { enneagram: null, wing: null, leftover: trimmed };
  }
  const wingRaw = match[2] ? (Number(match[2]) as EnneagramNumber) : null;
  const wing = wingRaw && wingIsValid(type, wingRaw) ? wingRaw : null;
  return { enneagram: type, wing, leftover: "" };
}

function parseNarrativeRole(value: string): NarrativeRole | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  if ((NARRATIVE_ROLES as readonly string[]).includes(normalized)) return normalized as NarrativeRole;
  const aliases: Record<string, NarrativeRole> = {
    hero: "protagonist",
    villain: "antagonist",
    sidekick: "supporting",
    "supporting_character": "supporting",
  };
  return aliases[normalized] ?? null;
}

function rankFromHeading(heading: string): ArchetypeRank {
  if (/shadow/i.test(heading)) return "shadow";
  if (/secondary/i.test(heading)) return "secondary";
  if (/primary/i.test(heading)) return "primary";
  return "primary";
}

function parseArchetypeLines(
  value: string,
  heading: string,
  meta: FieldAuthorityMeta,
  idPrefix: string,
): { archetypes: ArchetypeAssignment[]; leftover: string } {
  const lines = value
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  const defaultRank = rankFromHeading(heading);
  const archetypes: ArchetypeAssignment[] = [];
  const leftover: string[] = [];
  lines.forEach((line, index) => {
    const rankMatch = line.match(/^(primary|secondary|shadow)\s*[:\-–—]\s*(.+)$/i);
    const rank = rankMatch ? ((rankMatch[1]!.toLowerCase() as ArchetypeRank) || defaultRank) : defaultRank;
    const namePart = (rankMatch ? rankMatch[2]! : line).trim();
    const libraryHit = (ARCHETYPE_LIBRARY as readonly string[]).find(
      (name) => name.toLowerCase() === namePart.toLowerCase() || namePart.toLowerCase().startsWith(name.toLowerCase()),
    );
    if (libraryHit || namePart.length <= 48) {
      const name = libraryHit ?? namePart.replace(/\s*\(.+\)\s*$/, "").trim();
      if (!name) {
        leftover.push(line);
        return;
      }
      archetypes.push({
        id: `${idPrefix}_${index}`,
        name,
        custom: !(ARCHETYPE_LIBRARY as readonly string[]).includes(name),
        description: libraryHit && namePart.length > libraryHit.length ? namePart.slice(libraryHit.length).trim() : "",
        rank: (ARCHETYPE_RANKS as readonly string[]).includes(rank) ? rank : defaultRank,
        periodLabel: "",
        relationshipRecordId: null,
        evolvesFromId: null,
        evolutionNote: "",
        bookProjectId: null,
        approval: meta.approval === "approved" ? "draft" : meta.approval,
        provenance: meta.provenance,
      });
      return;
    }
    leftover.push(line);
  });
  return { archetypes, leftover: leftover.join("\n") };
}

function setFieldPath(
  profile: CharacterDevelopment,
  fieldPath: string,
  value: string,
  meta: FieldAuthorityMeta,
): void {
  if (fieldPath === "narrativeRole") {
    const role = parseNarrativeRole(value);
    if (role) {
      profile.narrativeRole = role;
      profile.fieldMeta[fieldPath] = { ...meta, approval: meta.approval === "approved" ? "draft" : meta.approval };
    }
    return;
  }
  if (fieldPath === "psychology.enneagram") {
    const parsed = parseEnneagramValue(value);
    if (parsed.enneagram) {
      profile.psychology.enneagram = parsed.enneagram;
      if (parsed.wing) profile.psychology.wing = parsed.wing;
      profile.fieldMeta[fieldPath] = { ...meta, approval: meta.approval === "approved" ? "draft" : meta.approval };
    }
    return;
  }
  if (fieldPath === "archetypes") {
    const parsed = parseArchetypeLines(value, meta.provenance.sourceHeading ?? "Archetypes", meta, `arch_upg_${profile.archetypes.length}`);
    for (const archetype of parsed.archetypes) {
      const duplicate = profile.archetypes.some(
        (item) => item.name.toLowerCase() === archetype.name.toLowerCase() && item.rank === archetype.rank,
      );
      if (!duplicate) profile.archetypes.push(archetype);
    }
    if (parsed.leftover.trim()) {
      profile.migrationHold.push({
        id: `mhold_arch_${profile.migrationHold.length}`,
        kind: "unclassified",
        fieldPath: "archetypes",
        heading: meta.provenance.sourceHeading ?? "Archetypes",
        text: parsed.leftover.trim(),
        sourceText: parsed.leftover.trim(),
        note: "Unparsed archetype notes retained for author review.",
        decision: "retained",
      });
    }
    return;
  }
  const [root, key] = fieldPath.split(".");
  if (!root || !key) return;
  if (root === "foundation" && (FOUNDATION_TEXT_KEYS as readonly string[]).includes(key)) {
    profile.foundation[key as FoundationTextKey] = value;
    profile.fieldMeta[fieldPath] = meta;
    return;
  }
  if (root === "voice" && (VOICE_TEXT_KEYS as readonly string[]).includes(key)) {
    profile.voice[key as VoiceTextKey] = value;
    profile.fieldMeta[fieldPath] = meta;
    return;
  }
  if (root === "psychology" && (PSYCHOLOGY_TEXT_KEYS as readonly string[]).includes(key)) {
    profile.psychology[key as PsychologyTextKey] = value;
    profile.fieldMeta[fieldPath] = meta;
    return;
  }
  if (root === "behavior" && (BEHAVIOR_TEXT_KEYS as readonly string[]).includes(key)) {
    profile.behavior[key as BehaviorTextKey] = value;
    profile.fieldMeta[fieldPath] = meta;
    return;
  }
  if (root === "livedExperience" && (LIVED_EXPERIENCE_TEXT_KEYS as readonly string[]).includes(key)) {
    profile.livedExperience[key as LivedExperienceTextKey] = value;
    profile.livedExperience.approval = meta.approval === "approved" ? "draft" : meta.approval;
    profile.livedExperience.aiVisibility = "omit";
    profile.livedExperience.provenance = meta.provenance;
    profile.fieldMeta[fieldPath] = { ...meta, approval: profile.livedExperience.approval };
    return;
  }
  if (root === "capabilities" && (CAPABILITIES_TEXT_KEYS as readonly string[]).includes(key)) {
    profile.capabilities[key as CapabilitiesTextKey] = value;
    profile.fieldMeta[fieldPath] = meta;
  }
}

function holdKindForDestination(destination: UpgradeDestination): MigrationHoldItem["kind"] {
  switch (destination) {
    case "historical_amendments":
      return "historical_amendments";
    case "protected_unknowns":
      return "protected_unknowns";
    case "proposed_unapproved":
    case "development":
      return "proposed_unapproved";
    case "relationships":
      return "relationships_notes";
    case "continuity":
      return "continuity_notes";
    default:
      return "unclassified";
  }
}

function pushHold(profile: CharacterDevelopment, item: DossierUpgradeItem, text: string, note: string): void {
  if (
    profile.migrationHold.some(
      (held) => held.id === item.id || normalizeText(held.sourceText) === normalizeText(item.sourceText),
    )
  ) {
    return;
  }
  profile.migrationHold.push({
    id: item.id,
    kind: holdKindForDestination(item.destination),
    fieldPath: item.fieldPath,
    heading: item.sourceHeading,
    text,
    sourceText: item.sourceText,
    note,
    decision: "retained",
  });
}

function mergeText(existing: string, incoming: string, heading: string): string {
  const a = existing.trim();
  const b = incoming.trim();
  if (!a) return b;
  if (!b || normalizeText(a) === normalizeText(b)) return a;
  return `${a}\n\n---\nFrom ${heading}:\n${b}`;
}

export function decisionsRequireExplicitConflictChoice(
  item: DossierUpgradeItem,
  decision: UpgradeDecision,
): boolean {
  if (decision === "defer" || decision === "reject" || decision === "keep_existing") return false;
  if (item.existingAuthority === "approved" && item.existingCanonical.trim()) {
    return decision === "accept";
  }
  return false;
}

/**
 * Apply author decisions onto a profile copy. Rejected items are skipped;
 * deferred and hold destinations stay in migrationHold; structured accepts
 * fill fields as draft/imported — never as approved canon.
 */
export function applyUpgradeDecisions(
  profile: CharacterDevelopment,
  analysis: DossierUpgradeAnalysis,
  decisions: readonly DossierUpgradeDecisionInput[],
  archive: DossierMarkdownArchive,
  meta: { body: string; sourceRevision: number },
): ApplyUpgradeResult {
  const next: CharacterDevelopment = JSON.parse(JSON.stringify(profile)) as CharacterDevelopment;
  next.migrationHold = [...(next.migrationHold ?? [])];
  next.fieldMeta = { ...(next.fieldMeta ?? {}) };
  const chosen = decisionMap(decisions);
  const appliedItemIds: string[] = [];
  const deferredItemIds: string[] = [];
  const rejectedItemIds: string[] = [];

  for (const item of analysis.items) {
    const pick = chosen.get(item.id);
    if (!pick || pick.decision === "defer") {
      deferredItemIds.push(item.id);
      continue;
    }
    if (pick.decision === "reject" || pick.decision === "keep_existing") {
      if (pick.decision === "reject") rejectedItemIds.push(item.id);
      else appliedItemIds.push(item.id);
      continue;
    }

    if (decisionsRequireExplicitConflictChoice(item, pick.decision)) {
      // Caller must validate; leave unchanged if they slipped through.
      deferredItemIds.push(item.id);
      continue;
    }

    const rawValue =
      pick.decision === "modify"
        ? pick.modifiedValue ?? item.proposedValue
        : pick.decision === "merge"
          ? mergeText(item.existingCanonical, item.proposedValue, item.sourceHeading)
          : item.proposedValue;
    const value = rawValue.trim();
    if (!value) {
      deferredItemIds.push(item.id);
      continue;
    }

    if (item.alreadyApplied && pick.decision !== "modify") {
      appliedItemIds.push(item.id);
      continue;
    }

    const structured = isStructuredConflictPath(item.fieldPath);
    const fieldApproval = approvalFromHint(item.authorityHint);

    if (structured && (pick.decision === "accept" || pick.decision === "modify" || pick.decision === "merge")) {
      if (item.destination === "protected_unknowns") {
        pushHold(next, item, value, "Protected unknown retained; not written as a fact.");
        appliedItemIds.push(item.id);
        continue;
      }
      const existingValue = existingAtPath(next, item.fieldPath);
      if (
        pick.decision === "accept" &&
        existingValue.trim() &&
        normalizeText(existingValue) === normalizeText(value)
      ) {
        appliedItemIds.push(item.id);
        continue;
      }
      setFieldPath(next, item.fieldPath, value, importedMeta(item, analysis.bodyHash, fieldApproval));
      appliedItemIds.push(item.id);
      continue;
    }

    pushHold(
      next,
      item,
      value,
      item.destination === "development"
        ? "Held as proposed development notes; not marked complete."
        : item.destination === "protected_unknowns"
          ? "Protected unknown retained without resolution."
          : "Retained from dossier upgrade for author review.",
    );
    appliedItemIds.push(item.id);
  }

  const decisionFingerprint = upgradeDecisionFingerprint(analysis.bodyHash, decisions);
  const already = archive.appliedFingerprints.includes(decisionFingerprint);
  const nextArchive =
    appliedItemIds.length || rejectedItemIds.length
      ? appendArchiveEntry(archive, {
          body: meta.body,
          sourceRevision: meta.sourceRevision,
          migrationFingerprint: decisionFingerprint,
        })
      : archive;

  const profileUnchanged = stableStringify(next) === stableStringify(profile);
  const archiveUnchanged = stableStringify(nextArchive) === stableStringify(archive);
  const noEffectiveChange = already || (profileUnchanged && archiveUnchanged);

  return {
    profile: next,
    archive: nextArchive,
    fields: {},
    appliedItemIds,
    deferredItemIds,
    rejectedItemIds,
    noEffectiveChange,
  };
}

/**
 * Idempotency key for an upgrade apply. Uses bodyHash (not the profile-dependent
 * analysis fingerprint) so re-applying the same decisions on the same Markdown
 * after fields are filled returns already_applied.
 */
export function upgradeDecisionFingerprint(
  bodyHash: string,
  decisions: readonly DossierUpgradeDecisionInput[],
): string {
  return sha256(
    stableStringify({
      bodyHash,
      decisions: [...decisions]
        .map((d) => ({ id: d.itemId, decision: d.decision, value: d.modifiedValue ?? "" }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }),
  );
}

export function fieldsAfterUpgrade(
  currentFields: JsonObject,
  profile: CharacterDevelopment,
  archive: DossierMarkdownArchive,
): JsonObject {
  return withDossierMarkdownArchive(withCharacterDevelopment(currentFields, profile), archive);
}

export function upgradePreviewToken(input: {
  recordId: string;
  revision: number;
  bodyHash: string;
  fingerprint: string;
  archiveVersion?: number;
}): string {
  return sha256(
    stableStringify({
      recordId: input.recordId,
      revision: input.revision,
      bodyHash: input.bodyHash,
      fingerprint: input.fingerprint,
      archiveVersion: input.archiveVersion ?? DOSSIER_MARKDOWN_ARCHIVE_VERSION,
    }),
  );
}

export function buildUpgradeChangePackage(input: {
  workspaceId: string;
  projectId: string;
  packageId?: string;
  recordId: string;
  expectedRevision: number;
  title: string;
  fields: JsonObject;
  summary?: string;
}): ChangePackageV1 {
  return {
    format: CHANGE_PACKAGE_FORMAT,
    formatVersion: CHANGE_PACKAGE_FORMAT_VERSION,
    packageId: input.packageId ?? newId("pkg"),
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    summary: input.summary ?? `Character dossier upgrade for ${input.title}`,
    approval: {
      status: "proposed",
      statement: "Author-reviewed Living Profile migration. Not auto-approved canon.",
    },
    scope: "reference",
    protectedOverrides: [],
    operations: [
      {
        op: "update_record",
        recordId: input.recordId,
        expectedRevision: input.expectedRevision,
        changes: {
          fields: {
            set: {
              [CHARACTER_DEVELOPMENT_KEY]: input.fields[CHARACTER_DEVELOPMENT_KEY] as JsonObject,
              [DOSSIER_MARKDOWN_ARCHIVE_KEY]: input.fields[DOSSIER_MARKDOWN_ARCHIVE_KEY] as JsonObject,
            },
          },
        },
        note: "Dossier Markdown upgrade into Living Character Profile fields.",
      },
    ],
    relatedRecords: [{ recordId: input.recordId, note: "Character dossier being upgraded." }],
  };
}

export function analyzeImportedMarkdown(
  markdown: string,
  profile?: CharacterDevelopment,
): DossierUpgradeAnalysis {
  return analyzeDossierUpgrade(markdown, profile ?? emptyCharacterDevelopment());
}

export function isUpgradeDecision(value: string): value is UpgradeDecision {
  return (UPGRADE_DECISIONS as readonly string[]).includes(value);
}

/** Promote a migration-hold item into a structured draft field (never approved). */
export function resolveHoldIntoField(
  profile: CharacterDevelopment,
  holdId: string,
): CharacterDevelopment | null {
  const held = profile.migrationHold.find((item) => item.id === holdId);
  if (!held || !isStructuredConflictPath(held.fieldPath)) return null;
  const next: CharacterDevelopment = JSON.parse(JSON.stringify(profile)) as CharacterDevelopment;
  next.migrationHold = next.migrationHold.filter((item) => item.id !== holdId);
  next.fieldMeta = { ...next.fieldMeta };
  setFieldPath(next, held.fieldPath, held.text, {
    approval: "draft",
    provenance: {
      origin: "imported",
      note: "Resolved from migration hold",
      sourceHeading: held.heading,
      updatedAt: new Date().toISOString(),
    },
  });
  return next;
}

export function updateHoldDecision(
  profile: CharacterDevelopment,
  holdId: string,
  decision: "retained" | "deferred",
): CharacterDevelopment {
  return {
    ...profile,
    migrationHold: profile.migrationHold.map((item) =>
      item.id === holdId ? { ...item, decision } : item,
    ),
  };
}

export function dismissHold(profile: CharacterDevelopment, holdId: string): CharacterDevelopment {
  return {
    ...profile,
    migrationHold: profile.migrationHold.filter((item) => item.id !== holdId),
  };
}
