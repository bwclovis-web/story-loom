/**
 * Author-reviewed migration from Markdown character dossiers into Living
 * Character Profiles (`fields.characterDevelopment`). Pure analysis and
 * merge helpers — nothing here writes the database. Authority stays with the
 * author: proposals never become approved canon automatically, mysteries stay
 * unresolved, and unclassified or conflicting text is kept for review.
 */

import {
  BEHAVIOR_TEXT_KEYS,
  CAPABILITIES_TEXT_KEYS,
  CHARACTER_DEVELOPMENT_KEY,
  emptyCharacterDevelopment,
  FOUNDATION_TEXT_KEYS,
  LIVED_EXPERIENCE_TEXT_KEYS,
  PSYCHOLOGY_TEXT_KEYS,
  VOICE_TEXT_KEYS,
  withCharacterDevelopment,
  type BehaviorTextKey,
  type CapabilitiesTextKey,
  type CharacterDevelopment,
  type FoundationTextKey,
  type LivedExperienceTextKey,
  type MigrationHoldItem,
  type PsychologyTextKey,
  type VoiceTextKey,
} from "@/domain/characterDevelopment";
import { newId } from "@/domain/ids";
import type { JsonObject } from "@/domain/json";
import { sha256, stableStringify } from "@/domain/json";
import type { AuthorityStatus } from "@/domain/statuses";
import {
  CHANGE_PACKAGE_FORMAT,
  CHANGE_PACKAGE_FORMAT_VERSION,
  type ChangePackageV1,
} from "@/changePackage/schema.v1";

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
export type UpgradeDestination = (typeof UPGRADE_DESTINATIONS)[number];

export const UPGRADE_DECISIONS = ["accept", "modify", "reject", "defer"] as const;
export type UpgradeDecision = (typeof UPGRADE_DECISIONS)[number];

export type UpgradeConfidence = "high" | "medium" | "low";

/** Heading → structured field. Lived/trauma headings are classified but never auto-approved. */
export const UPGRADE_HEADING_MAP: ReadonlyArray<{
  heading: string;
  destination: UpgradeDestination;
  fieldPath: string;
  confidence: UpgradeConfidence;
}> = [
  { heading: "Appearance", destination: "identity", fieldPath: "foundation.appearance", confidence: "high" },
  { heading: "Physical characteristics", destination: "identity", fieldPath: "foundation.physicalCharacteristics", confidence: "high" },
  { heading: "Pronouns", destination: "identity", fieldPath: "foundation.pronouns", confidence: "high" },
  { heading: "Ancestry", destination: "identity", fieldPath: "foundation.ancestry", confidence: "high" },
  { heading: "Age", destination: "identity", fieldPath: "foundation.lifeStage", confidence: "medium" },
  { heading: "Life stage", destination: "identity", fieldPath: "foundation.lifeStage", confidence: "high" },
  { heading: "Role", destination: "identity", fieldPath: "foundation.publicRole", confidence: "high" },
  { heading: "Public role", destination: "identity", fieldPath: "foundation.publicRole", confidence: "high" },
  { heading: "Private self", destination: "identity", fieldPath: "foundation.privateSelf", confidence: "high" },
  { heading: "Occupation", destination: "identity", fieldPath: "foundation.occupation", confidence: "high" },
  { heading: "Culture", destination: "identity", fieldPath: "foundation.culturalIdentity", confidence: "high" },
  { heading: "Cultural identity", destination: "identity", fieldPath: "foundation.culturalIdentity", confidence: "high" },
  { heading: "Background", destination: "identity", fieldPath: "foundation.formativeBackground", confidence: "high" },
  { heading: "Goals", destination: "identity", fieldPath: "foundation.externalGoal", confidence: "high" },
  { heading: "External goal", destination: "identity", fieldPath: "foundation.externalGoal", confidence: "high" },
  { heading: "Personality", destination: "psychology", fieldPath: "psychology.values", confidence: "medium" },
  { heading: "Desire", destination: "psychology", fieldPath: "psychology.coreDesire", confidence: "high" },
  { heading: "Core desire", destination: "psychology", fieldPath: "psychology.coreDesire", confidence: "high" },
  { heading: "Fear", destination: "psychology", fieldPath: "psychology.coreFear", confidence: "high" },
  { heading: "Core fear", destination: "psychology", fieldPath: "psychology.coreFear", confidence: "high" },
  { heading: "Wants", destination: "psychology", fieldPath: "psychology.consciousWants", confidence: "high" },
  { heading: "Needs", destination: "psychology", fieldPath: "psychology.unconsciousNeeds", confidence: "medium" },
  { heading: "Misbelief", destination: "psychology", fieldPath: "psychology.internalMisbelief", confidence: "high" },
  { heading: "Wound", destination: "psychology", fieldPath: "psychology.emotionalWound", confidence: "medium" },
  { heading: "Values", destination: "psychology", fieldPath: "psychology.values", confidence: "high" },
  { heading: "Strengths", destination: "psychology", fieldPath: "psychology.strengths", confidence: "high" },
  { heading: "Weaknesses", destination: "psychology", fieldPath: "psychology.weaknesses", confidence: "high" },
  { heading: "Contradictions", destination: "psychology", fieldPath: "psychology.contradictions", confidence: "high" },
  { heading: "Voice", destination: "voice", fieldPath: "voice.diction", confidence: "high" },
  { heading: "Diction", destination: "voice", fieldPath: "voice.diction", confidence: "high" },
  { heading: "Dialogue", destination: "voice", fieldPath: "voice.exampleDialogue", confidence: "high" },
  { heading: "Speech", destination: "voice", fieldPath: "voice.speechPatterns", confidence: "high" },
  { heading: "Speech patterns", destination: "voice", fieldPath: "voice.speechPatterns", confidence: "high" },
  { heading: "Humor", destination: "voice", fieldPath: "voice.humor", confidence: "high" },
  { heading: "Internal narrative", destination: "voice", fieldPath: "voice.internalNarrative", confidence: "high" },
  { heading: "Habits", destination: "behavior", fieldPath: "behavior.habits", confidence: "high" },
  { heading: "Mannerisms", destination: "behavior", fieldPath: "behavior.mannerisms", confidence: "high" },
  { heading: "Under pressure", destination: "behavior", fieldPath: "behavior.underPressure", confidence: "high" },
  { heading: "Social behavior", destination: "behavior", fieldPath: "behavior.socialBehavior", confidence: "high" },
  { heading: "Behavior", destination: "behavior", fieldPath: "behavior.habits", confidence: "medium" },
  { heading: "Lived experience", destination: "lived", fieldPath: "livedExperience.formativeExperiences", confidence: "high" },
  { heading: "Formative experience", destination: "lived", fieldPath: "livedExperience.formativeExperiences", confidence: "high" },
  { heading: "Formative experiences", destination: "lived", fieldPath: "livedExperience.formativeExperiences", confidence: "high" },
  { heading: "Trauma", destination: "lived", fieldPath: "livedExperience.trauma", confidence: "high" },
  { heading: "Neurodivergence", destination: "lived", fieldPath: "livedExperience.neurodivergence", confidence: "high" },
  { heading: "Disability", destination: "lived", fieldPath: "livedExperience.disability", confidence: "high" },
  { heading: "Coping", destination: "lived", fieldPath: "livedExperience.coping", confidence: "high" },
  { heading: "Portrayal", destination: "lived", fieldPath: "livedExperience.portrayalGuidance", confidence: "high" },
  { heading: "Portrayal guidance", destination: "lived", fieldPath: "livedExperience.portrayalGuidance", confidence: "high" },
  { heading: "Relationships", destination: "relationships", fieldPath: "hold.relationships", confidence: "medium" },
  { heading: "Allies", destination: "relationships", fieldPath: "hold.relationships", confidence: "medium" },
  { heading: "Enemies", destination: "relationships", fieldPath: "hold.relationships", confidence: "medium" },
  { heading: "Skills", destination: "capabilities", fieldPath: "capabilities.skills", confidence: "high" },
  { heading: "Abilities", destination: "capabilities", fieldPath: "capabilities.skills", confidence: "medium" },
  { heading: "Limitations", destination: "capabilities", fieldPath: "capabilities.limitations", confidence: "high" },
  { heading: "Magic", destination: "capabilities", fieldPath: "capabilities.magicalAbilities", confidence: "high" },
  { heading: "Equipment", destination: "capabilities", fieldPath: "capabilities.equipment", confidence: "high" },
  { heading: "Arc", destination: "development", fieldPath: "hold.development", confidence: "medium" },
  { heading: "Character arc", destination: "development", fieldPath: "hold.development", confidence: "medium" },
  { heading: "Development", destination: "development", fieldPath: "hold.development", confidence: "medium" },
  { heading: "Growth", destination: "development", fieldPath: "hold.development", confidence: "low" },
  { heading: "Knowledge", destination: "continuity", fieldPath: "hold.continuity", confidence: "medium" },
  { heading: "Secrets", destination: "continuity", fieldPath: "hold.continuity", confidence: "medium" },
  { heading: "Continuity", destination: "continuity", fieldPath: "hold.continuity", confidence: "medium" },
  { heading: "History", destination: "historical_amendments", fieldPath: "hold.historical", confidence: "medium" },
  { heading: "Amendments", destination: "historical_amendments", fieldPath: "hold.historical", confidence: "high" },
  { heading: "Changelog", destination: "historical_amendments", fieldPath: "hold.historical", confidence: "high" },
  { heading: "Unknown", destination: "protected_unknowns", fieldPath: "hold.unknowns", confidence: "high" },
  { heading: "Unknowns", destination: "protected_unknowns", fieldPath: "hold.unknowns", confidence: "high" },
  { heading: "Mysteries", destination: "protected_unknowns", fieldPath: "hold.unknowns", confidence: "high" },
  { heading: "Protected", destination: "protected_unknowns", fieldPath: "hold.unknowns", confidence: "high" },
  { heading: "Proposed", destination: "proposed_unapproved", fieldPath: "hold.proposed", confidence: "high" },
  { heading: "Draft", destination: "proposed_unapproved", fieldPath: "hold.proposed", confidence: "high" },
  { heading: "Ideas", destination: "proposed_unapproved", fieldPath: "hold.proposed", confidence: "medium" },
];

export interface MarkdownSection {
  heading: string;
  /** Heading with status tags stripped for classification. */
  cleanHeading: string;
  body: string;
  startOffset: number;
  endOffset: number;
  tags: string[];
}

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
  conflictWithIds: string[];
  supersedesIds: string[];
  supersededByIds: string[];
  authorityHint: AuthorityStatus | "ambiguous";
  requiresHumanReview: boolean;
  reviewReasons: string[];
  classificationConfidence: UpgradeConfidence;
  alreadyApplied: boolean;
  duplicateOfIds: string[];
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

export interface ApplyUpgradeResult {
  profile: CharacterDevelopment;
  archive: DossierMarkdownArchive;
  fields: JsonObject;
  appliedItemIds: string[];
  deferredItemIds: string[];
  rejectedItemIds: string[];
  noEffectiveChange: boolean;
}

const STATUS_TAG_RE =
  /\[(APPROVED(?:\s+FRAMEWORK)?|PROPOSED|DRAFT|UNKNOWN|PROTECTED|SUPERSEDED|UNRESOLVED|SELECTED)\]/gi;
const EM_DASH_STATUS_RE = /[—–-]\s*(SELECTED|PROPOSED|DRAFT|UNKNOWN|PROTECTED)\b/gi;

const SUPERSEDE_RE =
  /\b(supersedes?|replaces?|no longer|formerly|was previously|amendment|updated to|retcon)\b/i;
const PLANNED_RE =
  /\b(will (eventually|later|soon)|plans? to|intended to|eventually|future arc|planned growth|not yet)\b/i;
const MYSTERY_RE =
  /\b(unknown|mystery|unresolved|do not (resolve|reveal)|protected mystery|leave blank)\b/i;
const PROPOSED_RE = /\b(proposed|draft only|not canon|unapproved|maybe|consider)\b/i;

export function parseMarkdownSections(body: string): MarkdownSection[] {
  if (!body.trim()) return [];
  const parts = body.split(/\n(?=##\s+)/);
  const sections: MarkdownSection[] = [];
  let cursor = 0;
  for (const part of parts) {
    const startOffset = body.indexOf(part, cursor);
    const endOffset = startOffset + part.length;
    cursor = endOffset;
    const match = part.match(/^##\s+(.+?)\s*(?:\n|$)([\s\S]*)$/);
    if (!match) {
      if (!part.trim()) continue;
      sections.push({
        heading: "(preamble)",
        cleanHeading: "(preamble)",
        body: part.trim(),
        startOffset,
        endOffset,
        tags: [],
      });
      continue;
    }
    const heading = match[1]!.trim();
    const tags = extractTags(heading);
    sections.push({
      heading,
      cleanHeading: cleanHeadingText(heading),
      body: (match[2] ?? "").trim(),
      startOffset,
      endOffset,
      tags,
    });
  }
  return sections;
}

function extractTags(heading: string): string[] {
  const tags: string[] = [];
  for (const match of heading.matchAll(STATUS_TAG_RE)) {
    tags.push(match[1]!.toUpperCase().replace(/\s+/g, " "));
  }
  for (const match of heading.matchAll(EM_DASH_STATUS_RE)) {
    tags.push(match[1]!.toUpperCase());
  }
  return tags;
}

function cleanHeadingText(heading: string): string {
  return heading
    .replace(STATUS_TAG_RE, "")
    .replace(EM_DASH_STATUS_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function excerptOf(value: string, max = 160): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function existingAtPath(profile: CharacterDevelopment, fieldPath: string): string {
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
    const held = profile.migrationHold.filter((item) => item.kind === holdKindForPath(fieldPath) || item.fieldPath === fieldPath);
    return held.map((item) => item.text).join("\n\n");
  }
  return "";
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
  const lower = section.cleanHeading.toLowerCase();
  const mapped = UPGRADE_HEADING_MAP.find((item) => item.heading.toLowerCase() === lower);
  if (mapped) return mapped;

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
    const reviewReasons: string[] = [];
    let requiresHumanReview = false;

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
    if (mapped.destination === "relationships" || mapped.destination === "development" || mapped.destination === "continuity") {
      requiresHumanReview = true;
      reviewReasons.push("This destination is held for review rather than written as approved structured fields.");
    }

    const alreadyApplied =
      (existingCanonical.trim() !== "" && normalizeText(existingCanonical) === normalizeText(section.body)) ||
      profile.migrationHold.some(
        (held) => normalizeText(held.sourceText) === normalizeText(section.body) && held.fieldPath === mapped.fieldPath,
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
      conflictWithIds: [],
      supersedesIds: [],
      supersededByIds: [],
      authorityHint,
      requiresHumanReview,
      reviewReasons,
      classificationConfidence: mapped.confidence,
      alreadyApplied,
      duplicateOfIds: [],
    });
  }

  // Duplicates and contradictions by normalized text / shared field path.
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
        a.fieldPath.startsWith("foundation.") &&
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

  // Explicit supersession: later amendment sections point at earlier same-path items.
  for (let i = 0; i < items.length; i++) {
    const later = items[i]!;
    const section = sections.find((s) => s.startOffset === later.sourceStartOffset);
    if (!section) continue;
    if (!(SUPERSEDE_RE.test(section.heading) || SUPERSEDE_RE.test(section.body))) continue;
    for (let j = 0; j < i; j++) {
      const earlier = items[j]!;
      if (earlier.fieldPath !== later.fieldPath && earlier.destination === later.destination) {
        // same destination bucket is enough for historical holds
      }
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
      })),
    }),
  );

  return { bodyHash, sections, items, unclassifiedHeadings, fingerprint };
}

export function emptyDossierMarkdownArchive(): DossierMarkdownArchive {
  return { version: DOSSIER_MARKDOWN_ARCHIVE_VERSION, entries: [], appliedFingerprints: [] };
}

export function readDossierMarkdownArchive(fields: Readonly<Record<string, unknown>>): DossierMarkdownArchive {
  const raw = fields[DOSSIER_MARKDOWN_ARCHIVE_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyDossierMarkdownArchive();
  const row = raw as Record<string, unknown>;
  if (row.version !== DOSSIER_MARKDOWN_ARCHIVE_VERSION) return emptyDossierMarkdownArchive();
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
  return { version: DOSSIER_MARKDOWN_ARCHIVE_VERSION, entries, appliedFingerprints };
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

function setFieldPath(profile: CharacterDevelopment, fieldPath: string, value: string): void {
  const [root, key] = fieldPath.split(".");
  if (!root || !key) return;
  if (root === "foundation" && (FOUNDATION_TEXT_KEYS as readonly string[]).includes(key)) {
    profile.foundation[key as FoundationTextKey] = value;
    return;
  }
  if (root === "voice" && (VOICE_TEXT_KEYS as readonly string[]).includes(key)) {
    profile.voice[key as VoiceTextKey] = value;
    return;
  }
  if (root === "psychology" && (PSYCHOLOGY_TEXT_KEYS as readonly string[]).includes(key)) {
    profile.psychology[key as PsychologyTextKey] = value;
    return;
  }
  if (root === "behavior" && (BEHAVIOR_TEXT_KEYS as readonly string[]).includes(key)) {
    profile.behavior[key as BehaviorTextKey] = value;
    return;
  }
  if (root === "livedExperience" && (LIVED_EXPERIENCE_TEXT_KEYS as readonly string[]).includes(key)) {
    profile.livedExperience[key as LivedExperienceTextKey] = value;
    profile.livedExperience.approval = "draft";
    profile.livedExperience.aiVisibility = "omit";
    profile.livedExperience.provenance = { origin: "imported", note: "Accepted from dossier upgrade" };
    return;
  }
  if (root === "capabilities" && (CAPABILITIES_TEXT_KEYS as readonly string[]).includes(key)) {
    profile.capabilities[key as CapabilitiesTextKey] = value;
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
  if (profile.migrationHold.some((held) => held.id === item.id || normalizeText(held.sourceText) === normalizeText(item.sourceText))) {
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
    if (pick.decision === "reject") {
      rejectedItemIds.push(item.id);
      continue;
    }
    const value = (pick.decision === "modify" ? pick.modifiedValue ?? item.proposedValue : item.proposedValue).trim();
    if (!value) {
      deferredItemIds.push(item.id);
      continue;
    }

    const structured =
      item.fieldPath.startsWith("foundation.") ||
      item.fieldPath.startsWith("voice.") ||
      item.fieldPath.startsWith("psychology.") ||
      item.fieldPath.startsWith("behavior.") ||
      item.fieldPath.startsWith("livedExperience.") ||
      item.fieldPath.startsWith("capabilities.");

    if (structured && (pick.decision === "accept" || pick.decision === "modify")) {
      // Never treat migration as resolving mysteries into filled facts when destination is protected.
      if (item.destination === "protected_unknowns") {
        pushHold(next, item, value, "Protected unknown retained; not written as a fact.");
        appliedItemIds.push(item.id);
        continue;
      }
      setFieldPath(next, item.fieldPath, value);
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

  const decisionFingerprint = upgradeDecisionFingerprint(analysis.fingerprint, decisions);
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
  const noEffectiveChange = already || (profileUnchanged && appliedItemIds.length === 0);

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

export function upgradeDecisionFingerprint(
  analysisFingerprint: string,
  decisions: readonly DossierUpgradeDecisionInput[],
): string {
  return sha256(
    stableStringify({
      analysis: analysisFingerprint,
      decisions: [...decisions]
        .map((d) => ({ id: d.itemId, decision: d.decision, value: d.modifiedValue ?? "" }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }),
  );
}

/** Build fields payload: characterDevelopment + archive, preserving other keys. */
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
}): string {
  return sha256(stableStringify(input));
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

/** Analyze pasted/imported Markdown without a stored dossier body. */
export function analyzeImportedMarkdown(markdown: string, profile?: CharacterDevelopment): DossierUpgradeAnalysis {
  return analyzeDossierUpgrade(markdown, profile ?? emptyCharacterDevelopment());
}

export function isUpgradeDecision(value: string): value is UpgradeDecision {
  return (UPGRADE_DECISIONS as readonly string[]).includes(value);
}
