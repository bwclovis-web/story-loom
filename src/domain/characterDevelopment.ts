import {
  CHARACTER_HEADING_FIELD_MAP as SHARED_HEADING_FIELD_MAP,
  CHARACTER_HEADING_MAP,
  parseMarkdownSections,
} from "@/domain/characterHeadingExtraction";
import type { JsonObject, JsonValue } from "@/domain/json";
import type { AuthorityStatus } from "@/domain/statuses";
import { isAuthorityStatus } from "@/domain/statuses";
import { orderRelation, type OrderEdge } from "@/world/storyOrder";

export { CHARACTER_HEADING_FIELD_MAP } from "@/domain/characterHeadingExtraction";

/**
 * Optional structured character metadata stored on an existing character
 * dossier's `fields.characterDevelopment`. The dossier record stays the
 * identity. Empty or missing metadata means the dossier works as before.
 * Personality notes are writing aids, not diagnoses or behavioural rules.
 * Lived-experience notes are author-written writing context, not a diagnosis.
 * Version stays at 1; new keys are optional. Unknown top-level keys are kept
 * on save so a newer build's fields survive an older panel.
 */

export const CHARACTER_DEVELOPMENT_KEY = "characterDevelopment";
export const CHARACTER_DEVELOPMENT_VERSION = 1;

/** Top-level keys this build reads and writes. Other keys stay on save. */
export const CHARACTER_DEVELOPMENT_KNOWN_KEYS = [
  "version",
  "importance",
  "narrativeRole",
  "psychology",
  "archetypes",
  "bookImportance",
  "arcs",
  "stateChanges",
  "bookStates",
  "variant",
  "reviewNotes",
  "sourceRevision",
  "sourceBodyHash",
  "foundation",
  "voice",
  "bookVoices",
  "behavior",
  "livedExperience",
  "capabilities",
  "knowledge",
  "migrationHold",
  "fieldMeta",
  "seriesPlan",
] as const;

/** Panel sections for progressive disclosure. Changing importance never deletes filled data. */
export const PROFILE_SECTIONS = [
  "identity",
  "psychology",
  "voice",
  "behavior",
  "lived",
  "relationships",
  "capabilities",
  "development",
  "continuity",
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export const ENNEAGRAM_TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type EnneagramNumber = (typeof ENNEAGRAM_TYPES)[number];
export const ENNEAGRAM_CHOICES = [...ENNEAGRAM_TYPES, "unknown", "undecided", "not_applicable"] as const;
export type EnneagramChoice = (typeof ENNEAGRAM_CHOICES)[number];

/**
 * Narrative importance for progressive disclosure. Same character model for
 * every level; importance only recommends which sections to open first.
 */
export const IMPORTANCE_LEVELS = [
  "protagonist",
  "major",
  "supporting",
  "minor",
  "background",
] as const;
export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number];

/** Stored before Author Experience; remapped on read so old packages stay readable. */
export const LEGACY_IMPORTANCE_ALIASES: Record<string, ImportanceLevel> = {
  recurring: "supporting",
};

export function normalizeImportance(value: unknown): ImportanceLevel | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  if ((IMPORTANCE_LEVELS as readonly string[]).includes(raw)) return raw as ImportanceLevel;
  return LEGACY_IMPORTANCE_ALIASES[raw] ?? null;
}

export const NARRATIVE_ROLES = [
  "protagonist",
  "secondary_protagonist",
  "antagonist",
  "supporting",
  "mentor",
  "recurring",
  "minor",
] as const;
export type NarrativeRole = (typeof NARRATIVE_ROLES)[number];

export const PRESENCE_STATES = ["present", "introduced", "returning", "absent"] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

export const ARC_TEMPLATES = [
  "positive_change",
  "disillusionment",
  "corruption",
  "fall",
  "flat",
  "redemption",
  "recovery",
  "identity",
  "coming_of_age",
  "relationship",
  "ability",
  "custom",
] as const;
export type ArcTemplate = (typeof ARC_TEMPLATES)[number];

/** How the arc is moving. This is not a required sequence. */
export const ARC_MOVEMENTS = ["progressing", "paused", "regressed", "abandoned", "revisited", "complete"] as const;
export type ArcMovement = (typeof ARC_MOVEMENTS)[number];

export const MILESTONE_STATUSES = ["planned", "approved", "manuscript_confirmed", "ai_suggested"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MILESTONE_KINDS = [
  "milestone",
  "turning_point",
  "setback",
  "relationship_change",
  "transformative_event",
] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const STATE_FACETS = [
  "belief",
  "motivation",
  "emotion",
  "relationship",
  "knowledge",
  "ability",
  "injury",
  "possession",
  "responsibility",
  "location",
  "physical_condition",
  "psychological_response",
  "allegiance",
  "secret",
] as const;
export type StateFacet = (typeof STATE_FACETS)[number];

export const VARIANT_RELATIONSHIP_KINDS = [
  "alternate_timeline",
  "parallel_world",
  "clone",
  "reincarnation",
  "other",
] as const;
export type VariantRelationshipKind = (typeof VARIANT_RELATIONSHIP_KINDS)[number];

export const SERIES_PLAN_TEXT_KEYS = [
  "overallArc",
  "initialEmotionalState",
  "longTermGoals",
  "persistentInternalConflict",
  "majorTransformations",
  "intendedFinalState",
  "unresolvedThreads",
] as const;
export type SeriesPlanTextKey = (typeof SERIES_PLAN_TEXT_KEYS)[number];

export const BOOK_PLAN_TEXT_KEYS = [
  "externalGoal",
  "internalNeed",
  "activeMisbelief",
  "turningPoints",
  "relationshipChanges",
  "emotionalSetbacks",
  "transformativeEvents",
  "carryForwardConsequences",
] as const;
export type BookPlanTextKey = (typeof BOOK_PLAN_TEXT_KEYS)[number];

export const NARRATIVE_BOUNDARIES = ["baseline", "book_start", "at_point", "book_end"] as const;
export type NarrativeBoundary = (typeof NARRATIVE_BOUNDARIES)[number];

export const ARCHETYPE_LIBRARY = [
  "Hero",
  "Rebel",
  "Trickster",
  "Explorer",
  "Caregiver",
  "Sage",
  "Magician",
  "Lover",
  "Ruler",
  "Creator",
  "Mentor",
  "Guardian",
  "Everyman",
  "Shadow",
  "Herald",
] as const;

/** Psychological archetype ranks. Narrative role stays on CharacterDevelopment.narrativeRole. */
export const ARCHETYPE_RANKS = ["primary", "secondary", "shadow"] as const;
export type ArchetypeRank = (typeof ARCHETYPE_RANKS)[number];

export const PSYCHOLOGY_TEXT_KEYS = [
  "coreDesire",
  "coreFear",
  "coreMotivation",
  "consciousWants",
  "unconsciousNeeds",
  "internalMisbelief",
  "emotionalWound",
  "values",
  "moralBoundaries",
  "defenceMechanisms",
  "stressBehavior",
  "secureBehavior",
  "strengths",
  "weaknesses",
  "blindSpots",
  "contradictions",
  "emotionalExpression",
  "emotionalTriggers",
  "behavioralPatterns",
  "attachmentTendencies",
  "copingStrategies",
  "selfPerception",
  "externalPerception",
] as const;
export type PsychologyTextKey = (typeof PSYCHOLOGY_TEXT_KEYS)[number];

/** Traits a variant may inherit. Arcs, state, knowledge, lived experience, and capabilities are never inherited. */
export const INHERITABLE_KEYS = [
  "importance",
  "narrativeRole",
  "archetypes",
  "foundation",
  "voice",
  "behavior",
  ...PSYCHOLOGY_TEXT_KEYS,
  "enneagram",
  "wing",
] as const;
export type InheritableKey = (typeof INHERITABLE_KEYS)[number];

export const FOUNDATION_TEXT_KEYS = [
  "pronouns",
  "ancestry",
  "appearance",
  "physicalCharacteristics",
  "lifeStage",
  "publicRole",
  "privateSelf",
  "occupation",
  "culturalIdentity",
  "formativeBackground",
  "externalGoal",
] as const;
export type FoundationTextKey = (typeof FOUNDATION_TEXT_KEYS)[number];

export const VOICE_TEXT_KEYS = [
  "diction",
  "rhythm",
  "vocabulary",
  "verbalHabits",
  "humor",
  "emotionalExpression",
  "internalNarrative",
  "speechPatterns",
  "linesTheyReachFor",
  "linesTheyAvoid",
  "exampleDialogue",
  "approvedExamples",
  "consistencyGuardrails",
  "pointOfViewNotes",
] as const;
export type VoiceTextKey = (typeof VOICE_TEXT_KEYS)[number];

export const BEHAVIOR_TEXT_KEYS = [
  "habits",
  "mannerisms",
  "underPressure",
  "socialBehavior",
  "emotionalRegulation",
  "conflictAndAccountability",
  "interestsAndPreferences",
] as const;
export type BehaviorTextKey = (typeof BEHAVIOR_TEXT_KEYS)[number];

export const LIVED_EXPERIENCE_TEXT_KEYS = [
  "formativeExperiences",
  "neurodivergence",
  "disability",
  "trauma",
  "coping",
  "supportNeeds",
  "portrayalGuidance",
  "stereotypesToAvoid",
  "boundaryNote",
] as const;
export type LivedExperienceTextKey = (typeof LIVED_EXPERIENCE_TEXT_KEYS)[number];

export const CAPABILITIES_TEXT_KEYS = [
  "skills",
  "limitations",
  "magicalAbilities",
  "equipment",
] as const;
export type CapabilitiesTextKey = (typeof CAPABILITIES_TEXT_KEYS)[number];

/**
 * Suggested open sections by importance. Unlisted sections stay available
 * behind "Show more"; filled fields are never discarded when importance changes.
 */
export const IMPORTANCE_SECTION_TEMPLATES: Record<ImportanceLevel, readonly ProfileSection[]> = {
  protagonist: [...PROFILE_SECTIONS],
  major: [...PROFILE_SECTIONS],
  supporting: ["identity", "psychology", "voice", "behavior", "relationships", "development", "continuity"],
  minor: ["identity", "voice", "continuity"],
  background: ["identity"],
};

export const AI_VISIBILITY = ["include", "spoiler", "omit"] as const;
export type AiVisibility = (typeof AI_VISIBILITY)[number];

export const KNOWLEDGE_KINDS = ["knowledge", "belief", "misbelief", "secret"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const KNOWLEDGE_HOLDERS = ["character", "reader", "both"] as const;
export type KnowledgeHolder = (typeof KNOWLEDGE_HOLDERS)[number];

export const PROVENANCE_ORIGINS = ["author", "imported", "extracted"] as const;
export type ProvenanceOrigin = (typeof PROVENANCE_ORIGINS)[number];

export const CONTEXT_SLICES = ["dialogue", "continuity", "spoiler"] as const;
export type ContextSlice = (typeof CONTEXT_SLICES)[number];

export const REVIEW_CHECKS = [
  "personality",
  "voice",
  "motivation",
  "arc",
  "unearned",
  "regression",
  "forgotten_arc",
  "relationship",
  "knowledge",
  "cross_book",
  "secondary_coverage",
  "variant",
] as const;
export type ReviewCheck = (typeof REVIEW_CHECKS)[number];

export interface PersonalityFramework {
  id: string;
  name: string;
  notes: string;
  /** Defaults to draft for legacy rows; never inferred as approved. */
  approval: AuthorityStatus;
  provenance: ClaimProvenance;
}

export interface PsychologyProfile {
  enneagram: EnneagramChoice | null;
  wing: EnneagramNumber | null;
  coreDesire: string;
  coreFear: string;
  coreMotivation: string;
  consciousWants: string;
  unconsciousNeeds: string;
  internalMisbelief: string;
  emotionalWound: string;
  values: string;
  moralBoundaries: string;
  defenceMechanisms: string;
  stressBehavior: string;
  secureBehavior: string;
  strengths: string;
  weaknesses: string;
  blindSpots: string;
  contradictions: string;
  emotionalExpression: string;
  emotionalTriggers: string;
  behavioralPatterns: string;
  attachmentTendencies: string;
  copingStrategies: string;
  selfPerception: string;
  externalPerception: string;
  frameworks: PersonalityFramework[];
}

export interface ArchetypeAssignment {
  id: string;
  name: string;
  custom: boolean;
  description: string;
  rank: ArchetypeRank;
  /** Empty means the assignment is not limited to one narrative period. */
  periodLabel: string;
  /** When set, this archetype is how the character shows up in that relationship, not their only archetype. */
  relationshipRecordId: string | null;
  /** Optional pointer to an earlier archetype row this one evolves from. */
  evolvesFromId: string | null;
  evolutionNote: string;
  /** Optional book scope for this archetype expression. */
  bookProjectId: string | null;
  /** Defaults to draft for legacy rows; never inferred as approved. */
  approval: AuthorityStatus;
  provenance: ClaimProvenance;
}

export interface BookImportance {
  projectId: string;
  importance: ImportanceLevel | null;
  narrativeRole: NarrativeRole | null;
  presence: PresenceState;
}

export interface MilestoneLink {
  id: string;
  title: string;
  summary: string;
  status: MilestoneStatus;
  /** Defaults to milestone for legacy rows. */
  kind: MilestoneKind;
  bookProjectId: string | null;
  chapterRecordId: string | null;
  sceneRecordId: string | null;
  passageExcerpt: string;
  passageRevision: number | null;
  passageHash: string | null;
  storyEventId: string | null;
  weaveBeatId: string | null;
  referenceRecordId: string | null;
  notes: string;
}

export interface RelationshipPerception {
  recordId: string;
  feeling: string;
  belief: string;
}

export interface DevelopmentArc {
  id: string;
  title: string;
  description: string;
  template: ArcTemplate;
  approval: AuthorityStatus;
  movement: ArcMovement;
  scope: "series" | "book";
  bookProjectId: string | null;
  parentArcId: string | null;
  participantRecordIds: string[];
  relationId: string | null;
  perceptions: RelationshipPerception[];
  startingState: string;
  desiredOutcome: string;
  startingBelief: string;
  emergingTruth: string;
  internalConflict: string;
  externalConflict: string;
  stakes: string;
  notes: string;
  milestones: MilestoneLink[];
}

export interface StateChange {
  id: string;
  facet: StateFacet;
  /** "unknown" is an explicit unknown. Omitting a facet leaves it unset. */
  presence: "set" | "unknown";
  text: string;
  approval: AuthorityStatus;
  /** Planned changes never enter the canonical state, including when approval is approved. */
  planned: boolean;
  bookProjectId: string | null;
  storyEventId: string | null;
  chapterRecordId: string | null;
  sceneRecordId: string | null;
  /** Author order inside unresolved event ties. Not manuscript position. */
  sequence: number | null;
  note: string;
  /** When set, this change corrects an earlier state change without deleting it. */
  supersedesId: string | null;
  correctionNote: string;
  correctedAt: string | null;
}

export interface FacetValue {
  facet: StateFacet;
  presence: "set" | "unknown";
  text: string;
}

export interface BookState {
  projectId: string;
  /** Author narrative order of books. Not publication order and not scene order. */
  narrativeIndex: number | null;
  openingNote: string;
  closingNote: string;
  opening: FacetValue[];
  closing: FacetValue[];
  openingApproval: AuthorityStatus;
  closingApproval: AuthorityStatus;
  /** Optional book-level development plan fields. */
  externalGoal: string;
  internalNeed: string;
  activeMisbelief: string;
  arcTemplate: ArcTemplate | null;
  turningPoints: string;
  relationshipChanges: string;
  emotionalSetbacks: string;
  transformativeEvents: string;
  carryForwardConsequences: string;
}

export interface SeriesDevelopmentPlan {
  overallArc: string;
  initialEmotionalState: string;
  longTermGoals: string;
  persistentInternalConflict: string;
  majorTransformations: string;
  intendedFinalState: string;
  unresolvedThreads: string;
  approval: AuthorityStatus;
  provenance: ClaimProvenance;
}

export interface VariantLink {
  foundationRecordId: string;
  inheritedKeys: InheritableKey[];
  /** How this identity relates to the foundation. Defaults to other for legacy rows. */
  relationshipKind: VariantRelationshipKind;
  relationshipLabel: string;
}

export interface ReviewNote {
  id: string;
  check: ReviewCheck;
  text: string;
  evidence: string;
  uncertainty: string;
  /** Author kept the note. It is not canon and it does not edit the manuscript. */
  accepted: boolean;
}

export interface ClaimProvenance {
  origin: ProvenanceOrigin;
  note: string;
  sourceHeading?: string;
  sourceBodyHash?: string | null;
  updatedAt?: string;
}

/** Per-field authority for foundation / psychology / voice / behavior / capabilities text. */
export interface FieldAuthorityMeta {
  approval: AuthorityStatus;
  provenance: ClaimProvenance;
}

/**
 * Legacy plain-text fields without fieldMeta are treated as draft author notes —
 * never auto-classified as approved canon.
 */
export function defaultFieldMeta(origin: ProvenanceOrigin = "author"): FieldAuthorityMeta {
  return {
    approval: "draft",
    provenance: { origin, note: "" },
  };
}

export function fieldMetaOf(
  profile: CharacterDevelopment,
  fieldPath: string,
): FieldAuthorityMeta {
  return profile.fieldMeta[fieldPath] ?? defaultFieldMeta("author");
}

export function setFieldMeta(
  profile: CharacterDevelopment,
  fieldPath: string,
  meta: FieldAuthorityMeta,
): CharacterDevelopment {
  return {
    ...profile,
    fieldMeta: { ...profile.fieldMeta, [fieldPath]: meta },
  };
}

/** True when a structured text field may appear as established canon in AI context. */
export function fieldIsEstablishedCanon(profile: CharacterDevelopment, fieldPath: string): boolean {
  return fieldMetaOf(profile, fieldPath).approval === "approved";
}

export interface FoundationProfile {
  pronouns: string;
  ancestry: string;
  appearance: string;
  physicalCharacteristics: string;
  lifeStage: string;
  publicRole: string;
  privateSelf: string;
  occupation: string;
  culturalIdentity: string;
  formativeBackground: string;
  externalGoal: string;
}

export interface VoiceProfile {
  diction: string;
  rhythm: string;
  vocabulary: string;
  verbalHabits: string;
  humor: string;
  emotionalExpression: string;
  internalNarrative: string;
  speechPatterns: string;
  linesTheyReachFor: string;
  linesTheyAvoid: string;
  exampleDialogue: string;
  approvedExamples: string;
  consistencyGuardrails: string;
  pointOfViewNotes: string;
}

export interface BookVoice {
  projectId: string;
  voice: VoiceProfile;
}

export interface BehaviorProfile {
  habits: string;
  mannerisms: string;
  underPressure: string;
  socialBehavior: string;
  emotionalRegulation: string;
  conflictAndAccountability: string;
  interestsAndPreferences: string;
}

export interface LivedExperienceProfile {
  formativeExperiences: string;
  neurodivergence: string;
  disability: string;
  trauma: string;
  coping: string;
  supportNeeds: string;
  portrayalGuidance: string;
  stereotypesToAvoid: string;
  /** What must not be flattened when writing or prompting. */
  boundaryNote: string;
  approval: AuthorityStatus;
  /** Defaults to omit. Never inferred by Extract or Review. */
  aiVisibility: AiVisibility;
  provenance: ClaimProvenance;
}

export interface CapabilitiesProfile {
  skills: string;
  limitations: string;
  magicalAbilities: string;
  equipment: string;
  /** Existing worldbuilding / magic / object record ids. Not duplicated prose. */
  linkedRecordIds: string[];
}

export interface KnowledgeItem {
  id: string;
  kind: KnowledgeKind;
  statement: string;
  approval: AuthorityStatus;
  planned: boolean;
  bookProjectId: string | null;
  fromStoryEventId: string | null;
  untilStoryEventId: string | null;
  sceneRecordId: string | null;
  holder: KnowledgeHolder;
  aiVisibility: AiVisibility;
  establishedFactId: string | null;
  provenance: ClaimProvenance;
}

/** Held upgrade passages that must not silently become approved structured fields. */
export const MIGRATION_HOLD_KINDS = [
  "historical_amendments",
  "protected_unknowns",
  "proposed_unapproved",
  "unclassified",
  "relationships_notes",
  "continuity_notes",
] as const;
export type MigrationHoldKind = (typeof MIGRATION_HOLD_KINDS)[number];

export interface MigrationHoldItem {
  id: string;
  kind: MigrationHoldKind;
  fieldPath: string;
  heading: string;
  text: string;
  sourceText: string;
  note: string;
  decision: "retained" | "deferred";
}

export interface CharacterDevelopment {
  version: 1;
  importance: ImportanceLevel | null;
  narrativeRole: NarrativeRole | null;
  psychology: PsychologyProfile;
  archetypes: ArchetypeAssignment[];
  bookImportance: BookImportance[];
  arcs: DevelopmentArc[];
  stateChanges: StateChange[];
  bookStates: BookState[];
  /** Series-level development plan. Complements series-scoped arcs. */
  seriesPlan: SeriesDevelopmentPlan;
  variant: VariantLink | null;
  reviewNotes: ReviewNote[];
  /** Dossier revision and body hash when the author last checked this profile against the prose. */
  sourceRevision: number | null;
  sourceBodyHash: string | null;
  foundation: FoundationProfile;
  voice: VoiceProfile;
  bookVoices: BookVoice[];
  behavior: BehaviorProfile;
  livedExperience: LivedExperienceProfile;
  capabilities: CapabilitiesProfile;
  knowledge: KnowledgeItem[];
  /** Author-reviewed upgrade hold: conflicts, unknowns, proposals, unclassified. */
  migrationHold: MigrationHoldItem[];
  /**
   * Optional per-path authority for structured text fields
   * (e.g. foundation.appearance). Missing entries default to draft/author.
   */
  fieldMeta: Record<string, FieldAuthorityMeta>;
}

export interface ProfileProblem {
  path: string;
  message: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{6,80}$/;

export const ENNEAGRAM_GUIDE: Record<EnneagramNumber, { name: string; desire: string; fear: string; wings: string }> = {
  1: {
    name: "Reformer",
    desire: "to be good, accurate, and responsible",
    fear: "being corrupt, wrong, or careless",
    wings: "Nine softens toward calm; Two leans toward helping.",
  },
  2: {
    name: "Helper",
    desire: "to be needed and loved",
    fear: "being unwanted or useless to others",
    wings: "One leans toward principle; Three toward recognition.",
  },
  3: {
    name: "Achiever",
    desire: "to be valuable and successful",
    fear: "being worthless or exposed as a failure",
    wings: "Two leans toward charm; Four toward individuality.",
  },
  4: {
    name: "Individualist",
    desire: "to be uniquely themselves",
    fear: "having no identity or significance",
    wings: "Three leans toward image; Five toward privacy.",
  },
  5: {
    name: "Investigator",
    desire: "to be capable and self-sufficient",
    fear: "being helpless, invaded, or emptied",
    wings: "Four leans toward intensity; Six toward loyalty and vigilance.",
  },
  6: {
    name: "Loyalist",
    desire: "to have security and support",
    fear: "being without guidance or abandoned",
    wings: "Five leans toward analysis; Seven toward activity and options.",
  },
  7: {
    name: "Enthusiast",
    desire: "to be satisfied and free",
    fear: "being trapped in pain or deprivation",
    wings: "Six leans toward caution; Eight toward force.",
  },
  8: {
    name: "Challenger",
    desire: "to protect themselves and stay in control",
    fear: "being harmed, controlled, or weak",
    wings: "Seven leans toward appetite; Nine toward steadiness.",
  },
  9: {
    name: "Peacemaker",
    desire: "to have peace and stability",
    fear: "loss, conflict, or being cut off",
    wings: "Eight leans toward assertion; One toward conscience.",
  },
};

export function adjacentWings(type: EnneagramNumber): [EnneagramNumber, EnneagramNumber] {
  const lower = type === 1 ? 9 : ((type - 1) as EnneagramNumber);
  const higher = type === 9 ? 1 : ((type + 1) as EnneagramNumber);
  return [lower, higher];
}

export function wingIsValid(type: EnneagramChoice | null, wing: EnneagramNumber | null): boolean {
  if (wing === null) return true;
  if (type === null || typeof type !== "number") return false;
  const [a, b] = adjacentWings(type);
  return wing === a || wing === b;
}

function emptyPsychology(): PsychologyProfile {
  return {
    enneagram: null,
    wing: null,
    coreDesire: "",
    coreFear: "",
    coreMotivation: "",
    consciousWants: "",
    unconsciousNeeds: "",
    internalMisbelief: "",
    emotionalWound: "",
    values: "",
    moralBoundaries: "",
    defenceMechanisms: "",
    stressBehavior: "",
    secureBehavior: "",
    strengths: "",
    weaknesses: "",
    blindSpots: "",
    contradictions: "",
    emotionalExpression: "",
    emotionalTriggers: "",
    behavioralPatterns: "",
    attachmentTendencies: "",
    copingStrategies: "",
    selfPerception: "",
    externalPerception: "",
    frameworks: [],
  };
}

export function emptyFoundation(): FoundationProfile {
  return {
    pronouns: "",
    ancestry: "",
    appearance: "",
    physicalCharacteristics: "",
    lifeStage: "",
    publicRole: "",
    privateSelf: "",
    occupation: "",
    culturalIdentity: "",
    formativeBackground: "",
    externalGoal: "",
  };
}

export function emptyVoice(): VoiceProfile {
  return {
    diction: "",
    rhythm: "",
    vocabulary: "",
    verbalHabits: "",
    humor: "",
    emotionalExpression: "",
    internalNarrative: "",
    speechPatterns: "",
    linesTheyReachFor: "",
    linesTheyAvoid: "",
    exampleDialogue: "",
    approvedExamples: "",
    consistencyGuardrails: "",
    pointOfViewNotes: "",
  };
}

export function emptyBehavior(): BehaviorProfile {
  return {
    habits: "",
    mannerisms: "",
    underPressure: "",
    socialBehavior: "",
    emotionalRegulation: "",
    conflictAndAccountability: "",
    interestsAndPreferences: "",
  };
}

export function emptyLivedExperience(): LivedExperienceProfile {
  return {
    formativeExperiences: "",
    neurodivergence: "",
    disability: "",
    trauma: "",
    coping: "",
    supportNeeds: "",
    portrayalGuidance: "",
    stereotypesToAvoid: "",
    boundaryNote: "",
    approval: "draft",
    aiVisibility: "omit",
    provenance: { origin: "author", note: "" },
  };
}

export function emptyCapabilities(): CapabilitiesProfile {
  return {
    skills: "",
    limitations: "",
    magicalAbilities: "",
    equipment: "",
    linkedRecordIds: [],
  };
}

export function emptySeriesPlan(): SeriesDevelopmentPlan {
  return {
    overallArc: "",
    initialEmotionalState: "",
    longTermGoals: "",
    persistentInternalConflict: "",
    majorTransformations: "",
    intendedFinalState: "",
    unresolvedThreads: "",
    approval: "draft",
    provenance: { origin: "author", note: "" },
  };
}

export function emptyBookState(projectId: string): BookState {
  return {
    projectId,
    narrativeIndex: null,
    openingNote: "",
    closingNote: "",
    opening: [],
    closing: [],
    openingApproval: "draft",
    closingApproval: "draft",
    externalGoal: "",
    internalNeed: "",
    activeMisbelief: "",
    arcTemplate: null,
    turningPoints: "",
    relationshipChanges: "",
    emotionalSetbacks: "",
    transformativeEvents: "",
    carryForwardConsequences: "",
  };
}

export function emptyCharacterDevelopment(): CharacterDevelopment {
  return {
    version: 1,
    importance: null,
    narrativeRole: null,
    psychology: emptyPsychology(),
    archetypes: [],
    bookImportance: [],
    arcs: [],
    stateChanges: [],
    bookStates: [],
    seriesPlan: emptySeriesPlan(),
    variant: null,
    reviewNotes: [],
    sourceRevision: null,
    sourceBodyHash: null,
    foundation: emptyFoundation(),
    voice: emptyVoice(),
    bookVoices: [],
    behavior: emptyBehavior(),
    livedExperience: emptyLivedExperience(),
    capabilities: emptyCapabilities(),
    knowledge: [],
    migrationHold: [],
    fieldMeta: {},
  };
}

/** Sections suggested for this importance, plus any section that already has content. */
export function visibleProfileSections(profile: CharacterDevelopment): ProfileSection[] {
  const importance = profile.importance ? normalizeImportance(profile.importance) : null;
  const suggested = new Set<ProfileSection>(
    importance ? IMPORTANCE_SECTION_TEMPLATES[importance] : PROFILE_SECTIONS,
  );
  if (!sectionIsEmpty("identity", profile)) suggested.add("identity");
  if (!sectionIsEmpty("psychology", profile)) suggested.add("psychology");
  if (!sectionIsEmpty("voice", profile)) suggested.add("voice");
  if (!sectionIsEmpty("behavior", profile)) suggested.add("behavior");
  if (!sectionIsEmpty("lived", profile)) suggested.add("lived");
  if (!sectionIsEmpty("relationships", profile)) suggested.add("relationships");
  if (!sectionIsEmpty("capabilities", profile)) suggested.add("capabilities");
  if (!sectionIsEmpty("development", profile)) suggested.add("development");
  if (!sectionIsEmpty("continuity", profile)) suggested.add("continuity");
  return PROFILE_SECTIONS.filter((section) => suggested.has(section));
}

/**
 * Section-level completeness for recommended areas only. Optional fields inside
 * a section do not need to be filled; a section counts once it has any note.
 */
export type ProfileCompleteness = {
  importance: ImportanceLevel | null;
  suggestedSections: ProfileSection[];
  suggestedWithNotes: ProfileSection[];
  suggestedEmpty: ProfileSection[];
  filledSections: ProfileSection[];
  suggestedFilledCount: number;
  suggestedTotal: number;
};

export function profileCompleteness(profile: CharacterDevelopment): ProfileCompleteness {
  const importance = profile.importance ? normalizeImportance(profile.importance) : null;
  const suggestedSections = importance
    ? [...IMPORTANCE_SECTION_TEMPLATES[importance]]
    : (["identity"] as ProfileSection[]);
  const filledSections = PROFILE_SECTIONS.filter((section) => !sectionIsEmpty(section, profile));
  const suggestedWithNotes = suggestedSections.filter((section) => !sectionIsEmpty(section, profile));
  const suggestedEmpty = suggestedSections.filter((section) => sectionIsEmpty(section, profile));
  return {
    importance,
    suggestedSections,
    suggestedWithNotes,
    suggestedEmpty,
    filledSections,
    suggestedFilledCount: suggestedWithNotes.length,
    suggestedTotal: suggestedSections.length,
  };
}

export function sectionIsEmpty(section: ProfileSection, profile: CharacterDevelopment): boolean {
  switch (section) {
    case "identity":
      // Importance only recommends layout; it is not identity content for completeness.
      return !summarizeTextGroup(profile.foundation).trim() && profile.narrativeRole === null;
    case "psychology":
      return (
        !profile.psychology.enneagram &&
        !profile.psychology.wing &&
        !profile.psychology.frameworks.length &&
        !PSYCHOLOGY_TEXT_KEYS.some((key) => profile.psychology[key].trim()) &&
        profile.archetypes.length === 0
      );
    case "voice":
      return !summarizeTextGroup(profile.voice).trim() && profile.bookVoices.every((book) => !summarizeTextGroup(book.voice).trim());
    case "behavior":
      return !summarizeTextGroup(profile.behavior).trim();
    case "lived":
      return !LIVED_EXPERIENCE_TEXT_KEYS.some((key) => profile.livedExperience[key].trim());
    case "relationships":
      return !profile.arcs.some(
        (arc) => arc.template === "relationship" || arc.relationId || arc.perceptions.length > 0,
      );
    case "capabilities":
      return !CAPABILITIES_TEXT_KEYS.some((key) => profile.capabilities[key].trim()) && profile.capabilities.linkedRecordIds.length === 0;
    case "development":
      return profile.arcs.length === 0;
    case "continuity":
      return profile.stateChanges.length === 0 && profile.bookStates.length === 0 && profile.knowledge.length === 0;
    default:
      return true;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function enneagramOf(value: unknown): EnneagramChoice | null {
  if (typeof value === "number" && ENNEAGRAM_TYPES.includes(value as EnneagramNumber)) return value as EnneagramNumber;
  if (value === "unknown" || value === "undecided" || value === "not_applicable") return value;
  return null;
}

function wingOf(value: unknown): EnneagramNumber | null {
  return typeof value === "number" && ENNEAGRAM_TYPES.includes(value as EnneagramNumber) ? (value as EnneagramNumber) : null;
}

function idOf(value: unknown, fallback: string): string {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : fallback;
}

function approvalOf(value: unknown): AuthorityStatus {
  return typeof value === "string" && isAuthorityStatus(value) ? value : "draft";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readPsychology(raw: unknown, problems: ProfileProblem[]): PsychologyProfile {
  const base = emptyPsychology();
  const row = asRecord(raw);
  if (!row) return base;
  const enneagram = enneagramOf(row.enneagram);
  const wing = wingOf(row.wing);
  if (row.enneagram !== undefined && row.enneagram !== null && enneagram === null) {
    problems.push({ path: "psychology.enneagram", message: "Enneagram type is not a recognised choice." });
  }
  if (row.wing !== undefined && row.wing !== null && wing === null) {
    problems.push({ path: "psychology.wing", message: "Enneagram wing must be a type from 1 to 9." });
  }
  if (!wingIsValid(enneagram, wing)) {
    problems.push({ path: "psychology.wing", message: "A wing must be a neighboring Enneagram type, or empty." });
  }
  const next = { ...base, enneagram, wing: wingIsValid(enneagram, wing) ? wing : null };
  for (const key of PSYCHOLOGY_TEXT_KEYS) next[key] = text(row[key]);
  if (Array.isArray(row.frameworks)) {
    next.frameworks = row.frameworks.flatMap((item, index) => {
      const frame = asRecord(item);
      if (!frame) return [];
      const name = text(frame.name);
      return [
        {
          id: idOf(frame.id, `frame_${index}_saved`),
          name,
          notes: text(frame.notes),
          // Legacy rows without approval stay draft — never inferred as approved.
          approval: approvalOf(frame.approval),
          provenance: readProvenance(frame.provenance),
        },
      ];
    });
  }
  return next;
}

function archetypeRankOf(value: unknown): ArchetypeRank {
  return oneOf(value, ARCHETYPE_RANKS) ?? "primary";
}

function readArchetypes(raw: unknown): ArchetypeAssignment[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    const row = asRecord(item);
    if (!row) return [];
    const name = text(row.name);
    const library = (ARCHETYPE_LIBRARY as readonly string[]).includes(name);
    return [
      {
        id: idOf(row.id, `arch_${index}_saved`),
        name,
        custom: row.custom === true || !library,
        description: text(row.description),
        rank: archetypeRankOf(row.rank),
        periodLabel: text(row.periodLabel),
        relationshipRecordId: text(row.relationshipRecordId) || null,
        evolvesFromId: text(row.evolvesFromId) || null,
        evolutionNote: text(row.evolutionNote),
        bookProjectId: text(row.bookProjectId) || null,
        // Legacy rows without approval stay draft — never inferred as approved.
        approval: approvalOf(row.approval),
        provenance: readProvenance(row.provenance),
      },
    ];
  });
}

function readMilestones(raw: unknown): MilestoneLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    const row = asRecord(item);
    if (!row) return [];
    const title = text(row.title);
    const status = oneOf(row.status, MILESTONE_STATUSES) ?? "planned";
    return [
      {
        id: idOf(row.id, `mile_${index}_saved`),
        title,
        summary: text(row.summary),
        status,
        kind: oneOf(row.kind, MILESTONE_KINDS) ?? "milestone",
        bookProjectId: text(row.bookProjectId) || null,
        chapterRecordId: text(row.chapterRecordId) || null,
        sceneRecordId: text(row.sceneRecordId) || null,
        passageExcerpt: text(row.passageExcerpt),
        passageRevision: typeof row.passageRevision === "number" ? row.passageRevision : null,
        passageHash: text(row.passageHash) || null,
        storyEventId: text(row.storyEventId) || null,
        weaveBeatId: text(row.weaveBeatId) || null,
        referenceRecordId: text(row.referenceRecordId) || null,
        notes: text(row.notes),
      },
    ];
  });
}

function requireMilestoneTitles(arcs: readonly DevelopmentArc[], problems: ProfileProblem[]) {
  for (const arc of arcs) {
    for (const milestone of arc.milestones) {
      if (!milestone.title.trim()) problems.push({ path: `arcs.${arc.id}.milestones.${milestone.id}`, message: "A milestone needs a title." });
    }
  }
}

function readArcs(raw: unknown): DevelopmentArc[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    const row = asRecord(item);
    if (!row) return [];
    const title = text(row.title);
    const perceptions = Array.isArray(row.perceptions)
      ? row.perceptions.flatMap((entry) => {
          const perception = asRecord(entry);
          if (!perception) return [];
          const recordId = text(perception.recordId);
          if (!recordId) return [];
          return [{ recordId, feeling: text(perception.feeling), belief: text(perception.belief) }];
        })
      : [];
    return [
      {
        id: idOf(row.id, `arc_${index}_saved`),
        title,
        description: text(row.description),
        template: oneOf(row.template, ARC_TEMPLATES) ?? "custom",
        approval: approvalOf(row.approval),
        movement: oneOf(row.movement, ARC_MOVEMENTS) ?? "progressing",
        scope: row.scope === "book" ? "book" : "series",
        bookProjectId: text(row.bookProjectId) || null,
        parentArcId: text(row.parentArcId) || null,
        participantRecordIds: Array.isArray(row.participantRecordIds)
          ? [...new Set(row.participantRecordIds.filter((id): id is string => typeof id === "string" && id.trim() !== ""))]
          : [],
        relationId: text(row.relationId) || null,
        perceptions,
        startingState: text(row.startingState),
        desiredOutcome: text(row.desiredOutcome),
        startingBelief: text(row.startingBelief),
        emergingTruth: text(row.emergingTruth),
        internalConflict: text(row.internalConflict),
        externalConflict: text(row.externalConflict),
        stakes: text(row.stakes),
        notes: text(row.notes),
        milestones: readMilestones(row.milestones),
      },
    ];
  });
}

function readFacetList(raw: unknown): FacetValue[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];
    const facet = oneOf(row.facet, STATE_FACETS);
    if (!facet) return [];
    const presence = row.presence === "unknown" ? "unknown" : "set";
    return [{ facet, presence, text: presence === "unknown" ? "" : text(row.text) }];
  });
}

function readStateChanges(raw: unknown): StateChange[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    const row = asRecord(item);
    if (!row) return [];
    const facet = oneOf(row.facet, STATE_FACETS);
    if (!facet) return [];
    const presence = row.presence === "unknown" ? "unknown" : "set";
    return [
      {
        id: idOf(row.id, `state_${index}_saved`),
        facet,
        presence,
        text: presence === "unknown" ? "" : text(row.text),
        approval: approvalOf(row.approval),
        planned: row.planned === true,
        bookProjectId: text(row.bookProjectId) || null,
        storyEventId: text(row.storyEventId) || null,
        chapterRecordId: text(row.chapterRecordId) || null,
        sceneRecordId: text(row.sceneRecordId) || null,
        sequence: typeof row.sequence === "number" && Number.isFinite(row.sequence) ? row.sequence : null,
        note: text(row.note),
        supersedesId: text(row.supersedesId) || null,
        correctionNote: text(row.correctionNote),
        correctedAt: text(row.correctedAt) || null,
      },
    ];
  });
}

function readBookStates(raw: unknown): BookState[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];
    const projectId = text(row.projectId);
    if (!projectId) return [];
    return [
      {
        projectId,
        narrativeIndex: typeof row.narrativeIndex === "number" && Number.isFinite(row.narrativeIndex) ? row.narrativeIndex : null,
        openingNote: text(row.openingNote),
        closingNote: text(row.closingNote),
        opening: readFacetList(row.opening),
        closing: readFacetList(row.closing),
        openingApproval: approvalOf(row.openingApproval),
        closingApproval: approvalOf(row.closingApproval),
        externalGoal: text(row.externalGoal),
        internalNeed: text(row.internalNeed),
        activeMisbelief: text(row.activeMisbelief),
        arcTemplate: oneOf(row.arcTemplate, ARC_TEMPLATES),
        turningPoints: text(row.turningPoints),
        relationshipChanges: text(row.relationshipChanges),
        emotionalSetbacks: text(row.emotionalSetbacks),
        transformativeEvents: text(row.transformativeEvents),
        carryForwardConsequences: text(row.carryForwardConsequences),
      },
    ];
  });
}

function readSeriesPlan(raw: unknown): SeriesDevelopmentPlan {
  const base = emptySeriesPlan();
  const row = asRecord(raw);
  if (!row) return base;
  return {
    overallArc: text(row.overallArc),
    initialEmotionalState: text(row.initialEmotionalState),
    longTermGoals: text(row.longTermGoals),
    persistentInternalConflict: text(row.persistentInternalConflict),
    majorTransformations: text(row.majorTransformations),
    intendedFinalState: text(row.intendedFinalState),
    unresolvedThreads: text(row.unresolvedThreads),
    approval: approvalOf(row.approval),
    provenance: readProvenance(row.provenance),
  };
}

function readBookImportance(raw: unknown): BookImportance[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];
    const projectId = text(row.projectId);
    if (!projectId) return [];
    return [
      {
        projectId,
        importance: normalizeImportance(row.importance),
        narrativeRole: oneOf(row.narrativeRole, NARRATIVE_ROLES),
        presence: oneOf(row.presence, PRESENCE_STATES) ?? "present",
      },
    ];
  });
}

function readVariant(raw: unknown, problems: ProfileProblem[]): VariantLink | null {
  const row = asRecord(raw);
  if (!row) return null;
  const foundationRecordId = text(row.foundationRecordId);
  if (!foundationRecordId) return null;
  const inheritedKeys = Array.isArray(row.inheritedKeys)
    ? row.inheritedKeys.filter((key): key is InheritableKey => (INHERITABLE_KEYS as readonly string[]).includes(String(key)))
    : [];
  if (Array.isArray(row.inheritedKeys) && inheritedKeys.length !== row.inheritedKeys.length) {
    problems.push({
      path: "variant.inheritedKeys",
      message: "Only foundational traits can be inherited. Arcs, knowledge, and state history stay with each variant.",
    });
  }
  return {
    foundationRecordId,
    inheritedKeys,
    relationshipKind: oneOf(row.relationshipKind, VARIANT_RELATIONSHIP_KINDS) ?? "other",
    relationshipLabel: text(row.relationshipLabel),
  };
}

function readTextGroup<T extends string>(raw: unknown, keys: readonly T[], empty: Record<T, string>): Record<T, string> {
  const next = { ...empty };
  const row = asRecord(raw);
  if (!row) return next;
  for (const key of keys) next[key] = text(row[key]);
  return next;
}

function readFoundation(raw: unknown): FoundationProfile {
  return readTextGroup(raw, FOUNDATION_TEXT_KEYS, emptyFoundation());
}

function readVoice(raw: unknown): VoiceProfile {
  return readTextGroup(raw, VOICE_TEXT_KEYS, emptyVoice());
}

function readBehavior(raw: unknown): BehaviorProfile {
  return readTextGroup(raw, BEHAVIOR_TEXT_KEYS, emptyBehavior());
}

function readCapabilities(raw: unknown): CapabilitiesProfile {
  const base = emptyCapabilities();
  const row = asRecord(raw);
  if (!row) return base;
  const next = readTextGroup(raw, CAPABILITIES_TEXT_KEYS, base);
  const linkedRecordIds = Array.isArray(row.linkedRecordIds)
    ? [...new Set(row.linkedRecordIds.filter((id): id is string => typeof id === "string" && ID_PATTERN.test(id)))]
    : [];
  return { ...next, linkedRecordIds };
}

function readBookVoices(raw: unknown): BookVoice[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];
    const projectId = text(row.projectId);
    if (!projectId) return [];
    return [{ projectId, voice: readVoice(row.voice) }];
  });
}

function readProvenance(raw: unknown): ClaimProvenance {
  const row = asRecord(raw);
  if (!row) return { origin: "author", note: "" };
  return {
    origin: oneOf(row.origin, PROVENANCE_ORIGINS) ?? "author",
    note: text(row.note),
    sourceHeading: text(row.sourceHeading) || undefined,
    sourceBodyHash: text(row.sourceBodyHash) || null,
    updatedAt: text(row.updatedAt) || undefined,
  };
}

function readFieldMeta(raw: unknown): Record<string, FieldAuthorityMeta> {
  const row = asRecord(raw);
  if (!row) return {};
  const out: Record<string, FieldAuthorityMeta> = {};
  for (const [path, value] of Object.entries(row)) {
    const meta = asRecord(value);
    if (!meta) continue;
    out[path] = {
      approval: approvalOf(meta.approval),
      provenance: readProvenance(meta.provenance),
    };
  }
  return out;
}

function readLivedExperience(raw: unknown): LivedExperienceProfile {
  const base = emptyLivedExperience();
  const row = asRecord(raw);
  if (!row) return base;
  const next = { ...base };
  for (const key of LIVED_EXPERIENCE_TEXT_KEYS) next[key] = text(row[key]);
  next.approval = approvalOf(row.approval);
  next.aiVisibility = oneOf(row.aiVisibility, AI_VISIBILITY) ?? "omit";
  next.provenance = readProvenance(row.provenance);
  return next;
}

function readKnowledge(raw: unknown): KnowledgeItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    const row = asRecord(item);
    if (!row) return [];
    const kind = oneOf(row.kind, KNOWLEDGE_KINDS);
    const statement = text(row.statement);
    if (!kind || !statement) return [];
    const defaultVisibility: AiVisibility = kind === "secret" ? "omit" : "include";
    return [
      {
        id: idOf(row.id, `know_${index}_saved`),
        kind,
        statement,
        approval: approvalOf(row.approval),
        planned: row.planned === true,
        bookProjectId: text(row.bookProjectId) || null,
        fromStoryEventId: text(row.fromStoryEventId) || null,
        untilStoryEventId: text(row.untilStoryEventId) || null,
        sceneRecordId: text(row.sceneRecordId) || null,
        holder: oneOf(row.holder, KNOWLEDGE_HOLDERS) ?? "character",
        aiVisibility: oneOf(row.aiVisibility, AI_VISIBILITY) ?? defaultVisibility,
        establishedFactId: text(row.establishedFactId) || null,
        provenance: readProvenance(row.provenance),
      },
    ];
  });
}

function readMigrationHold(raw: unknown): MigrationHoldItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    const row = asRecord(item);
    if (!row) return [];
    const kind = oneOf(row.kind, MIGRATION_HOLD_KINDS);
    const textBody = text(row.text) || text(row.sourceText);
    if (!kind || !textBody) return [];
    return [
      {
        id: idOf(row.id, `mhold_${index}_saved`),
        kind,
        fieldPath: text(row.fieldPath),
        heading: text(row.heading),
        text: textBody,
        sourceText: text(row.sourceText) || textBody,
        note: text(row.note),
        decision: row.decision === "deferred" ? "deferred" : "retained",
      },
    ];
  });
}

/**
 * True when stored development names a version this build cannot load.
 * Saves must refuse so an empty profile cannot wipe the stored object.
 */
export function unsupportedCharacterDevelopmentVersion(fields: Readonly<Record<string, unknown>>): boolean {
  const raw = fields[CHARACTER_DEVELOPMENT_KEY];
  if (raw === undefined || raw === null) return false;
  const row = asRecord(raw);
  if (!row) return false;
  return row.version !== undefined && row.version !== CHARACTER_DEVELOPMENT_VERSION;
}

export function readCharacterDevelopment(fields: Readonly<Record<string, unknown>>): {
  profile: CharacterDevelopment;
  problems: ProfileProblem[];
} {
  const problems: ProfileProblem[] = [];
  const raw = fields[CHARACTER_DEVELOPMENT_KEY];
  if (raw === undefined || raw === null) return { profile: emptyCharacterDevelopment(), problems };
  const row = asRecord(raw);
  if (!row) {
    problems.push({ path: CHARACTER_DEVELOPMENT_KEY, message: "Character development metadata is not an object." });
    return { profile: emptyCharacterDevelopment(), problems };
  }
  if (row.version !== undefined && row.version !== CHARACTER_DEVELOPMENT_VERSION) {
    problems.push({ path: "version", message: "This character development version is not supported." });
    return { profile: emptyCharacterDevelopment(), problems };
  }
  const profile: CharacterDevelopment = {
    version: 1,
    importance: normalizeImportance(row.importance),
    narrativeRole: oneOf(row.narrativeRole, NARRATIVE_ROLES),
    psychology: readPsychology(row.psychology, problems),
    archetypes: readArchetypes(row.archetypes),
    bookImportance: readBookImportance(row.bookImportance),
    arcs: readArcs(row.arcs),
    stateChanges: readStateChanges(row.stateChanges),
    bookStates: readBookStates(row.bookStates),
    seriesPlan: readSeriesPlan(row.seriesPlan),
    variant: readVariant(row.variant, problems),
    reviewNotes: Array.isArray(row.reviewNotes)
      ? row.reviewNotes.flatMap((item, index) => {
          const note = asRecord(item);
          if (!note) return [];
          const check = oneOf(note.check, REVIEW_CHECKS);
          const body = text(note.text);
          if (!check || !body) return [];
          return [
            {
              id: idOf(note.id, `note_${index}_saved`),
              check,
              text: body,
              evidence: text(note.evidence),
              uncertainty: text(note.uncertainty),
              accepted: note.accepted === true,
            },
          ];
        })
      : [],
    sourceRevision: typeof row.sourceRevision === "number" ? row.sourceRevision : null,
    sourceBodyHash: text(row.sourceBodyHash) || null,
    foundation: readFoundation(row.foundation),
    voice: readVoice(row.voice),
    bookVoices: readBookVoices(row.bookVoices),
    behavior: readBehavior(row.behavior),
    livedExperience: readLivedExperience(row.livedExperience),
    capabilities: readCapabilities(row.capabilities),
    knowledge: readKnowledge(row.knowledge),
    migrationHold: readMigrationHold(row.migrationHold),
    fieldMeta: readFieldMeta(row.fieldMeta),
  };
  problems.push(...validateCharacterDevelopment(profile));
  return { profile, problems };
}

export function validateCharacterDevelopment(profile: CharacterDevelopment): ProfileProblem[] {
  const problems: ProfileProblem[] = [];
  if (!wingIsValid(profile.psychology.enneagram, profile.psychology.wing)) {
    problems.push({ path: "psychology.wing", message: "A wing must be a neighboring Enneagram type, or empty." });
  }
  for (const framework of profile.psychology.frameworks) {
    if (!framework.name.trim()) problems.push({ path: `frameworks.${framework.id}`, message: "A personality framework needs a name." });
  }
  const archetypeIds = new Set(profile.archetypes.map((item) => item.id));
  for (const archetype of profile.archetypes) {
    if (!archetype.name.trim()) problems.push({ path: `archetypes.${archetype.id}`, message: "An archetype needs a name." });
    if (archetype.evolvesFromId) {
      if (!archetypeIds.has(archetype.evolvesFromId)) {
        problems.push({
          path: `archetypes.${archetype.id}.evolvesFromId`,
          message: "Archetype evolution must point to another archetype on this character.",
        });
      } else if (archetype.evolvesFromId === archetype.id) {
        problems.push({
          path: `archetypes.${archetype.id}.evolvesFromId`,
          message: "An archetype cannot evolve from itself.",
        });
      }
    }
  }
  if (archetypeEvolutionCycle(profile.archetypes)) {
    problems.push({ path: "archetypes", message: "Archetype evolution links cannot form a circle." });
  }
  const arcIds = new Set<string>();
  for (const arc of profile.arcs) {
    if (!arc.title.trim()) problems.push({ path: `arcs.${arc.id}.title`, message: "An arc needs a title." });
    if (arcIds.has(arc.id)) problems.push({ path: `arcs.${arc.id}`, message: "Two arcs share an id." });
    arcIds.add(arc.id);
    if (arc.scope === "book" && !arc.bookProjectId) {
      problems.push({ path: `arcs.${arc.id}.bookProjectId`, message: "A book arc needs the book it belongs to." });
    }
    if (arc.parentArcId && !profile.arcs.some((item) => item.id === arc.parentArcId)) {
      problems.push({ path: `arcs.${arc.id}.parentArcId`, message: "The parent arc is not on this character." });
    }
    const perceptionIds = new Set(arc.perceptions.map((item) => item.recordId));
    if (perceptionIds.size !== arc.perceptions.length) {
      problems.push({ path: `arcs.${arc.id}.perceptions`, message: "Each person can have only one perception entry on an arc." });
    }
  }
  if (arcParentCycle(profile.arcs)) {
    problems.push({ path: "arcs", message: "Arc parent links cannot form a circle." });
  }
  requireMilestoneTitles(profile.arcs, problems);
  for (const arc of profile.arcs) {
    if (!arc.parentArcId) continue;
    const parent = profile.arcs.find((item) => item.id === arc.parentArcId);
    if (!parent) continue;
    if (parent.scope === "book" && (arc.scope !== "book" || arc.bookProjectId !== parent.bookProjectId)) {
      problems.push({
        path: `arcs.${arc.id}.parentArcId`,
        message: "A book arc can contain only arcs from that same book.",
      });
    }
  }
  if (profile.variant && profile.variant.inheritedKeys.some((key) => !(INHERITABLE_KEYS as readonly string[]).includes(key))) {
    problems.push({ path: "variant.inheritedKeys", message: "A variant cannot inherit arcs or state history." });
  }
  const stateIds = new Set(profile.stateChanges.map((change) => change.id));
  for (const change of profile.stateChanges) {
    if (change.supersedesId) {
      if (!stateIds.has(change.supersedesId)) {
        problems.push({
          path: `stateChanges.${change.id}.supersedesId`,
          message: "A correction must point to another state change on this character.",
        });
      } else if (change.supersedesId === change.id) {
        problems.push({
          path: `stateChanges.${change.id}.supersedesId`,
          message: "A state change cannot correct itself.",
        });
      }
    }
  }
  const bookIds = new Set<string>();
  for (const book of profile.bookStates) {
    if (bookIds.has(book.projectId)) problems.push({ path: `bookStates.${book.projectId}`, message: "A book has two state rows." });
    bookIds.add(book.projectId);
  }
  const voiceBookIds = new Set<string>();
  for (const book of profile.bookVoices) {
    if (voiceBookIds.has(book.projectId)) {
      problems.push({ path: `bookVoices.${book.projectId}`, message: "A book has two voice overrides." });
    }
    voiceBookIds.add(book.projectId);
  }
  const knowledgeIds = new Set<string>();
  for (const item of profile.knowledge) {
    if (!item.statement.trim()) problems.push({ path: `knowledge.${item.id}`, message: "A knowledge item needs a statement." });
    if (knowledgeIds.has(item.id)) problems.push({ path: `knowledge.${item.id}`, message: "Two knowledge items share an id." });
    knowledgeIds.add(item.id);
  }
  return problems;
}

function arcParentCycle(arcs: readonly DevelopmentArc[]): boolean {
  const parent = new Map(arcs.map((arc) => [arc.id, arc.parentArcId]));
  for (const arc of arcs) {
    const seen = new Set<string>();
    let cursor: string | null = arc.id;
    while (cursor) {
      if (seen.has(cursor)) return true;
      seen.add(cursor);
      cursor = parent.get(cursor) ?? null;
    }
  }
  return false;
}

function archetypeEvolutionCycle(archetypes: readonly ArchetypeAssignment[]): boolean {
  const parent = new Map(archetypes.map((item) => [item.id, item.evolvesFromId]));
  for (const archetype of archetypes) {
    const seen = new Set<string>();
    let cursor: string | null = archetype.id;
    while (cursor) {
      if (seen.has(cursor)) return true;
      seen.add(cursor);
      cursor = parent.get(cursor) ?? null;
    }
  }
  return false;
}

export function variantWouldCycle(
  links: readonly { recordId: string; foundationRecordId: string }[],
  recordId: string,
  foundationRecordId: string,
): boolean {
  if (recordId === foundationRecordId) return true;
  const next = new Map<string, string[]>();
  for (const link of links) {
    const list = next.get(link.recordId) ?? [];
    list.push(link.foundationRecordId);
    next.set(link.recordId, list);
  }
  const seen = new Set<string>();
  const stack = [foundationRecordId];
  while (stack.length) {
    const id = stack.pop();
    if (id === undefined) break;
    if (id === recordId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const step of next.get(id) ?? []) stack.push(step);
  }
  return false;
}

/**
 * Copy every other field key through, and replace only the development object.
 * Unknown top-level keys already stored on the development object are kept so
 * an older build cannot strip a newer key by saving.
 */
export function withCharacterDevelopment(fields: JsonObject, profile: CharacterDevelopment): JsonObject {
  const known = toJson(profile);
  const previous = asRecord(fields[CHARACTER_DEVELOPMENT_KEY]);
  const merged: JsonObject = { ...known };
  const knownSet = new Set<string>(CHARACTER_DEVELOPMENT_KNOWN_KEYS);
  if (previous) {
    for (const key of Object.keys(previous)) {
      if (!knownSet.has(key) && !(key in known)) merged[key] = previous[key] as JsonValue;
    }
  }
  return { ...fields, [CHARACTER_DEVELOPMENT_KEY]: merged };
}

function toJson(profile: CharacterDevelopment): JsonObject {
  return JSON.parse(JSON.stringify(profile)) as JsonObject;
}

/** Problems that block writing a development object from a change package or save. */
export function characterDevelopmentWriteProblems(value: unknown): ProfileProblem[] {
  if (value === undefined || value === null) return [];
  const row = asRecord(value);
  if (!row) return [{ path: CHARACTER_DEVELOPMENT_KEY, message: "Character development metadata is not an object." }];
  if (row.version !== undefined && row.version !== CHARACTER_DEVELOPMENT_VERSION) {
    return [{ path: "version", message: "This character development version is not supported." }];
  }
  return readCharacterDevelopment({ [CHARACTER_DEVELOPMENT_KEY]: value }).problems;
}

export function developmentIsEmpty(profile: CharacterDevelopment): boolean {
  const blank = emptyCharacterDevelopment();
  return JSON.stringify(profile) === JSON.stringify(blank);
}

/** True when the view has at least one section with readable notes (importance alone does not count). */
export function characterProfileHasDisplayContent(profile: CharacterDevelopment): boolean {
  return PROFILE_SECTIONS.some((section) => !sectionIsEmpty(section, profile));
}

export type ProfileFreshness = "current" | "unchecked" | "stale";

export function profileFreshness(profile: CharacterDevelopment, revision: number, bodyHash?: string | null): ProfileFreshness {
  if (profile.sourceRevision === null && !profile.sourceBodyHash) return developmentIsEmpty(profile) ? "current" : "unchecked";
  if (profile.sourceRevision !== null && profile.sourceRevision !== revision) return "stale";
  if (bodyHash && profile.sourceBodyHash && profile.sourceBodyHash !== bodyHash) return "stale";
  if (profile.sourceRevision === null) return "unchecked";
  return "current";
}

export function markProfileChecked(profile: CharacterDevelopment, revision: number, bodyHash: string): CharacterDevelopment {
  return { ...profile, sourceBodyHash: bodyHash, sourceRevision: revision };
}

/**
 * Replace one book's opening or closing state. Approved text in every other
 * book is left as it was. Rewriting this book's approved state needs an
 * explicit allowance.
 */
export function replaceBookState(
  profile: CharacterDevelopment,
  next: BookState,
  options: { allowApprovedRewrite: boolean },
): { ok: true; profile: CharacterDevelopment } | { ok: false; message: string } {
  const current = profile.bookStates.find((book) => book.projectId === next.projectId);
  if (current && !options.allowApprovedRewrite) {
    const openingLocked = current.openingApproval === "approved" && JSON.stringify(current.opening) !== JSON.stringify(next.opening);
    const closingLocked = current.closingApproval === "approved" && JSON.stringify(current.closing) !== JSON.stringify(next.closing);
    const noteLocked =
      (current.openingApproval === "approved" && current.openingNote !== next.openingNote) ||
      (current.closingApproval === "approved" && current.closingNote !== next.closingNote);
    if (openingLocked || closingLocked || noteLocked) {
      return { ok: false, message: "Approved book state changes only when you confirm the rewrite." };
    }
  }
  const bookStates = [
    ...profile.bookStates.filter((book) => book.projectId !== next.projectId),
    { ...emptyBookState(next.projectId), ...next },
  ];
  return { ok: true, profile: { ...profile, bookStates } };
}

export interface NarrativePoint {
  bookProjectId: string | null;
  storyEventId: string | null;
  /** Used only as an explicit anchor id, never as manuscript order. */
  sequence: number | null;
  /** When omitted, behaves as at_point for legacy callers. */
  boundary?: NarrativeBoundary;
  chapterRecordId?: string | null;
  sceneRecordId?: string | null;
}

export type ResolvedFacet =
  | { presence: "unset" }
  | { presence: "unknown"; changeId: string }
  | { presence: "set"; text: string; changeId: string };

export interface StateConflict {
  facet: StateFacet;
  changeIds: string[];
  reason: string;
}

export interface ResolvedState {
  facets: Record<StateFacet, ResolvedFacet>;
  /** Approved changes that could not be placed before or after the point. */
  unplacedChangeIds: string[];
  /** Ambiguous ties or overlapping corrections the author should review. */
  conflicts: StateConflict[];
  /** Prior state changes replaced by later corrections; kept for history. */
  supersededChangeIds: string[];
}

export interface StateComparisonDiff {
  facet: StateFacet;
  from: ResolvedFacet;
  to: ResolvedFacet;
  kind: "unchanged" | "added" | "cleared" | "changed" | "became_unknown" | "conflict";
}

export interface StateComparison {
  from: ResolvedState;
  to: ResolvedState;
  diffs: StateComparisonDiff[];
}

export interface TimelineEntry {
  id: string;
  kind: "series_baseline" | "book_start" | "milestone" | "state_change" | "book_end";
  title: string;
  detail: string;
  bookProjectId: string | null;
  storyEventId: string | null;
  chapterRecordId: string | null;
  sceneRecordId: string | null;
  planned: boolean;
  status: string;
  narrativeIndex: number | null;
  sequence: number | null;
}

function bookIndex(profile: CharacterDevelopment, projectId: string | null): number | null {
  if (!projectId) return null;
  const book = profile.bookStates.find((item) => item.projectId === projectId);
  return book?.narrativeIndex ?? null;
}

type Placement = "at_or_before" | "after" | "unresolved";

function compareChanges(profile: CharacterDevelopment, left: StateChange, right: StateChange, edges: readonly OrderEdge[]): Placement {
  if (left.storyEventId && right.storyEventId && left.storyEventId !== right.storyEventId) {
    const relation = orderRelation(edges, left.storyEventId, right.storyEventId);
    if (relation === "before") return "at_or_before";
    if (relation === "after") return "after";
  }
  const leftBook = bookIndex(profile, left.bookProjectId);
  const rightBook = bookIndex(profile, right.bookProjectId);
  if (leftBook !== null && rightBook !== null && leftBook !== rightBook) {
    return leftBook < rightBook ? "at_or_before" : "after";
  }
  if (left.sequence !== null && right.sequence !== null && left.sequence !== right.sequence) {
    return left.sequence < right.sequence ? "at_or_before" : "after";
  }
  if (left.storyEventId && right.storyEventId && left.storyEventId === right.storyEventId) return "at_or_before";
  return "unresolved";
}

function placeAgainstPoint(profile: CharacterDevelopment, change: StateChange, point: NarrativePoint, edges: readonly OrderEdge[]): Placement {
  if (change.sceneRecordId && point.sceneRecordId) {
    if (change.sceneRecordId === point.sceneRecordId) return "at_or_before";
  }
  if (change.chapterRecordId && point.chapterRecordId) {
    if (change.chapterRecordId === point.chapterRecordId && !change.sceneRecordId) return "at_or_before";
  }
  if (change.storyEventId && point.storyEventId) {
    if (change.storyEventId === point.storyEventId) return "at_or_before";
    const relation = orderRelation(edges, change.storyEventId, point.storyEventId);
    if (relation === "before") return "at_or_before";
    if (relation === "after") return "after";
  }
  const changeBook = bookIndex(profile, change.bookProjectId);
  const pointBook = bookIndex(profile, point.bookProjectId);
  if (changeBook !== null && pointBook !== null && changeBook !== pointBook) {
    return changeBook < pointBook ? "at_or_before" : "after";
  }
  if (
    change.bookProjectId &&
    point.bookProjectId &&
    change.bookProjectId !== point.bookProjectId &&
    (changeBook === null || pointBook === null)
  ) {
    return "unresolved";
  }
  if (change.sequence !== null && point.sequence !== null) {
    return change.sequence <= point.sequence ? "at_or_before" : "after";
  }
  if (!change.storyEventId && !point.storyEventId && change.sequence === null && point.sequence === null) {
    if (!change.bookProjectId || change.bookProjectId === point.bookProjectId) return "at_or_before";
  }
  if (change.storyEventId && point.storyEventId) return "unresolved";
  if (change.sequence !== null && point.sequence === null && (!point.storyEventId || !change.storyEventId)) return "unresolved";
  if (!change.bookProjectId || change.bookProjectId === point.bookProjectId) {
    if (change.sequence === null && point.sequence === null && !change.storyEventId) return "at_or_before";
  }
  return "unresolved";
}

function applyFacetValues(
  facets: Record<StateFacet, ResolvedFacet>,
  values: readonly FacetValue[],
  sourceId: string,
) {
  for (const value of values) {
    facets[value.facet] =
      value.presence === "unknown"
        ? { presence: "unknown", changeId: sourceId }
        : { presence: "set", text: value.text, changeId: sourceId };
  }
}

function changeIsSuperseded(profile: CharacterDevelopment, changeId: string): boolean {
  return profile.stateChanges.some(
    (change) => change.supersedesId === changeId && change.approval === "approved" && !change.planned,
  );
}

/**
 * Record an explicit correction. The prior change is marked superseded and kept;
 * the replacement links via supersedesId. Nothing is deleted.
 */
export function supersedeStateChange(
  profile: CharacterDevelopment,
  previousId: string,
  replacement: Omit<StateChange, "id" | "supersedesId"> & { id?: string },
  idFor: (prefix: string) => string,
): { ok: true; profile: CharacterDevelopment } | { ok: false; message: string } {
  const previous = profile.stateChanges.find((change) => change.id === previousId);
  if (!previous) return { ok: false, message: "The state change to correct was not found." };
  const nextId = replacement.id ?? idFor("state");
  const corrected: StateChange = {
    ...previous,
    approval: "superseded",
    correctedAt: new Date().toISOString(),
    correctionNote: replacement.correctionNote || previous.correctionNote || "Corrected by a later state change.",
  };
  const nextChange: StateChange = {
    ...replacement,
    id: nextId,
    supersedesId: previousId,
    correctionNote: replacement.correctionNote || `Corrects ${previousId}`,
    correctedAt: null,
    chapterRecordId: replacement.chapterRecordId ?? previous.chapterRecordId,
  };
  return {
    ok: true,
    profile: {
      ...profile,
      stateChanges: [...profile.stateChanges.map((change) => (change.id === previousId ? corrected : change)), nextChange],
    },
  };
}

/**
 * Canonical state at a narrative point. Only approved, unplanned changes that
 * are at or before the point apply. Unknown stays distinct from unset.
 * Later books do not rewrite earlier approved changes; they only add later ones.
 * Superseded corrections stay in history but do not win the facet.
 */
export function resolveCharacterState(
  profile: CharacterDevelopment,
  point: NarrativePoint,
  edges: readonly OrderEdge[] = [],
): ResolvedState {
  const facets = Object.fromEntries(STATE_FACETS.map((facet) => [facet, { presence: "unset" }])) as Record<StateFacet, ResolvedFacet>;
  const conflicts: StateConflict[] = [];
  const supersededChangeIds = profile.stateChanges
    .filter((change) => change.approval === "superseded" || changeIsSuperseded(profile, change.id))
    .map((change) => change.id);
  const boundary = point.boundary ?? "at_point";

  if (boundary === "baseline") {
    return { facets, unplacedChangeIds: [], conflicts, supersededChangeIds };
  }

  if (boundary === "book_start" && point.bookProjectId) {
    const book = profile.bookStates.find((item) => item.projectId === point.bookProjectId);
    if (book && book.openingApproval === "approved") {
      applyFacetValues(facets, book.opening, `book_open_${book.projectId}`);
    }
  }

  const candidates = profile.stateChanges.filter(
    (change) => change.approval === "approved" && !change.planned && !changeIsSuperseded(profile, change.id),
  );
  const unplacedChangeIds: string[] = [];
  const included: StateChange[] = [];
  for (const change of candidates) {
    if (boundary === "book_start") {
      // Opening facets already applied; in-book changes start after the opening.
      if (change.bookProjectId === point.bookProjectId) continue;
      const changeBook = bookIndex(profile, change.bookProjectId);
      const pointBook = bookIndex(profile, point.bookProjectId);
      if (changeBook !== null && pointBook !== null && changeBook < pointBook) {
        included.push(change);
      } else if (change.bookProjectId && point.bookProjectId && change.bookProjectId !== point.bookProjectId) {
        if (changeBook === null || pointBook === null) unplacedChangeIds.push(change.id);
      }
      continue;
    }
    if (boundary === "book_end" && point.bookProjectId) {
      const changeBook = bookIndex(profile, change.bookProjectId);
      const pointBook = bookIndex(profile, point.bookProjectId);
      if (change.bookProjectId === point.bookProjectId) {
        included.push(change);
        continue;
      }
      if (changeBook !== null && pointBook !== null) {
        if (changeBook <= pointBook) included.push(change);
        continue;
      }
      if (change.bookProjectId && change.bookProjectId !== point.bookProjectId) {
        unplacedChangeIds.push(change.id);
      }
      continue;
    }
    const placement = placeAgainstPoint(profile, change, point, edges);
    if (placement === "unresolved") unplacedChangeIds.push(change.id);
    else if (placement === "at_or_before") included.push(change);
  }

  for (const facet of STATE_FACETS) {
    const group = included.filter((change) => change.facet === facet);
    if (!group.length) continue;
    let latest = group[0]!;
    const tied: string[] = [];
    for (const change of group.slice(1)) {
      const placement = compareChanges(profile, latest, change, edges);
      if (placement === "at_or_before") latest = change;
      else if (placement === "unresolved") {
        tied.push(change.id);
        if (group.indexOf(change) > group.indexOf(latest)) latest = change;
      }
    }
    if (tied.length) {
      conflicts.push({
        facet,
        changeIds: [latest.id, ...tied],
        reason: "Two or more approved changes could not be ordered relative to each other.",
      });
    }
    facets[facet] =
      latest.presence === "unknown"
        ? { presence: "unknown", changeId: latest.id }
        : { presence: "set", text: latest.text, changeId: latest.id };
  }

  if (boundary === "book_end" && point.bookProjectId) {
    const book = profile.bookStates.find((item) => item.projectId === point.bookProjectId);
    if (book && book.closingApproval === "approved") {
      applyFacetValues(facets, book.closing, `book_close_${book.projectId}`);
    }
  }

  return { facets, unplacedChangeIds, conflicts, supersededChangeIds };
}

export function compareCharacterStates(
  profile: CharacterDevelopment,
  fromPoint: NarrativePoint,
  toPoint: NarrativePoint,
  edges: readonly OrderEdge[] = [],
): StateComparison {
  const from = resolveCharacterState(profile, fromPoint, edges);
  const to = resolveCharacterState(profile, toPoint, edges);
  const diffs: StateComparisonDiff[] = STATE_FACETS.map((facet) => {
    const left = from.facets[facet];
    const right = to.facets[facet];
    const conflicted = to.conflicts.some((item) => item.facet === facet) || from.conflicts.some((item) => item.facet === facet);
    if (conflicted) return { facet, from: left, to: right, kind: "conflict" as const };
    if (left.presence === right.presence) {
      if (left.presence === "unset") return { facet, from: left, to: right, kind: "unchanged" as const };
      if (left.presence === "unknown" && right.presence === "unknown") {
        return { facet, from: left, to: right, kind: "unchanged" as const };
      }
      if (left.presence === "set" && right.presence === "set" && left.text === right.text) {
        return { facet, from: left, to: right, kind: "unchanged" as const };
      }
    }
    if (left.presence === "unset" && right.presence === "set") return { facet, from: left, to: right, kind: "added" as const };
    if (left.presence === "set" && right.presence === "unset") return { facet, from: left, to: right, kind: "cleared" as const };
    if (right.presence === "unknown") return { facet, from: left, to: right, kind: "became_unknown" as const };
    return { facet, from: left, to: right, kind: "changed" as const };
  });
  return { from, to, diffs };
}

export function buildCharacterTimeline(
  profile: CharacterDevelopment,
  books: readonly { id: string; label: string }[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    {
      id: "series_baseline",
      kind: "series_baseline",
      title: "Series baseline",
      detail: profile.seriesPlan.initialEmotionalState || profile.seriesPlan.overallArc || "No series plan notes yet.",
      bookProjectId: null,
      storyEventId: null,
      chapterRecordId: null,
      sceneRecordId: null,
      planned: false,
      status: profile.seriesPlan.approval,
      narrativeIndex: null,
      sequence: null,
    },
  ];
  const bookOrder = [...profile.bookStates].sort((a, b) => {
    const left = a.narrativeIndex ?? Number.POSITIVE_INFINITY;
    const right = b.narrativeIndex ?? Number.POSITIVE_INFINITY;
    if (left !== right) return left - right;
    return a.projectId.localeCompare(b.projectId);
  });
  const labeled = (projectId: string | null) =>
    projectId ? books.find((book) => book.id === projectId)?.label ?? projectId : "Series";

  for (const book of bookOrder) {
    entries.push({
      id: `book_start_${book.projectId}`,
      kind: "book_start",
      title: `${labeled(book.projectId)} — beginning`,
      detail: book.openingNote || book.externalGoal || "Opening state",
      bookProjectId: book.projectId,
      storyEventId: null,
      chapterRecordId: null,
      sceneRecordId: null,
      planned: book.openingApproval !== "approved",
      status: book.openingApproval,
      narrativeIndex: book.narrativeIndex,
      sequence: null,
    });
  }

  for (const arc of profile.arcs) {
    for (const milestone of arc.milestones) {
      entries.push({
        id: milestone.id,
        kind: "milestone",
        title: milestone.title || arc.title,
        detail: `${arc.title} · ${milestone.kind.replaceAll("_", " ")} · ${milestone.status.replaceAll("_", " ")}`,
        bookProjectId: milestone.bookProjectId ?? arc.bookProjectId,
        storyEventId: milestone.storyEventId,
        chapterRecordId: milestone.chapterRecordId,
        sceneRecordId: milestone.sceneRecordId,
        planned: milestone.status === "planned" || milestone.status === "ai_suggested",
        status: milestone.status,
        narrativeIndex: bookIndex(profile, milestone.bookProjectId ?? arc.bookProjectId),
        sequence: null,
      });
    }
  }

  for (const change of profile.stateChanges) {
    entries.push({
      id: change.id,
      kind: "state_change",
      title: `${change.facet}${change.presence === "unknown" ? " (unknown)" : ""}`,
      detail: change.planned
        ? `Planned · ${change.note || change.text || "State change"}`
        : change.approval === "superseded"
          ? `Superseded · ${change.correctionNote || change.text || change.note}`
          : change.text || change.note || change.approval,
      bookProjectId: change.bookProjectId,
      storyEventId: change.storyEventId,
      chapterRecordId: change.chapterRecordId,
      sceneRecordId: change.sceneRecordId,
      planned: change.planned,
      status: change.approval,
      narrativeIndex: bookIndex(profile, change.bookProjectId),
      sequence: change.sequence,
    });
  }

  for (const book of bookOrder) {
    entries.push({
      id: `book_end_${book.projectId}`,
      kind: "book_end",
      title: `${labeled(book.projectId)} — end`,
      detail: book.closingNote || book.carryForwardConsequences || "Closing state",
      bookProjectId: book.projectId,
      storyEventId: null,
      chapterRecordId: null,
      sceneRecordId: null,
      planned: book.closingApproval !== "approved",
      status: book.closingApproval,
      narrativeIndex: book.narrativeIndex,
      sequence: null,
    });
  }

  return entries.sort((a, b) => {
    const leftBook = a.narrativeIndex ?? Number.POSITIVE_INFINITY;
    const rightBook = b.narrativeIndex ?? Number.POSITIVE_INFINITY;
    if (leftBook !== rightBook) return leftBook - rightBook;
    const kindRank = (kind: TimelineEntry["kind"]) =>
      kind === "series_baseline" ? 0 : kind === "book_start" ? 1 : kind === "milestone" ? 2 : kind === "state_change" ? 3 : 4;
    if (kindRank(a.kind) !== kindRank(b.kind)) return kindRank(a.kind) - kindRank(b.kind);
    const leftSeq = a.sequence ?? Number.POSITIVE_INFINITY;
    const rightSeq = b.sequence ?? Number.POSITIVE_INFINITY;
    if (leftSeq !== rightSeq) return leftSeq - rightSeq;
    return a.id.localeCompare(b.id);
  });
}

export function knowledgeWindowOpen(item: KnowledgeItem, point: NarrativePoint, edges: readonly OrderEdge[]): boolean {
  if (item.bookProjectId && point.bookProjectId && item.bookProjectId !== point.bookProjectId) return false;
  // Secrets are not automatic bible knowledge: they need a story-event or scene anchor.
  if (item.kind === "secret" && !item.fromStoryEventId && !item.sceneRecordId) return false;
  if (item.fromStoryEventId && point.storyEventId) {
    if (item.fromStoryEventId !== point.storyEventId) {
      const relation = orderRelation(edges, item.fromStoryEventId, point.storyEventId);
      if (relation !== "before") return false;
    }
  } else if (item.fromStoryEventId && !point.storyEventId) {
    return false;
  }
  if (item.untilStoryEventId && point.storyEventId) {
    if (item.untilStoryEventId === point.storyEventId) return false;
    const relation = orderRelation(edges, item.untilStoryEventId, point.storyEventId);
    if (relation === "before" || relation === "cycle") return false;
  }
  // Scene-anchored knowledge: do not treat a later/other scene as already known
  // when no story-event order is available.
  if (item.sceneRecordId) {
    if (point.sceneRecordId && item.sceneRecordId !== point.sceneRecordId && !item.fromStoryEventId) {
      return false;
    }
    if (!point.sceneRecordId && !item.fromStoryEventId && point.chapterRecordId) {
      return false;
    }
  }
  return true;
}

/**
 * Approved, unplanned knowledge items in force at a narrative point.
 * Does not rewrite the one-line knowledge/belief state facets.
 */
export function resolveKnowledgeAtPoint(
  profile: CharacterDevelopment,
  point: NarrativePoint,
  edges: readonly OrderEdge[] = [],
): KnowledgeItem[] {
  return profile.knowledge.filter(
    (item) => item.approval === "approved" && !item.planned && knowledgeWindowOpen(item, point, edges),
  );
}

export type MilestoneFreshness = "current" | "stale" | "unlinked";

export function milestoneFreshness(
  milestone: MilestoneLink,
  current: { revision: number; hash: string } | null,
): MilestoneFreshness {
  if (!milestone.passageRevision && !milestone.passageHash) return "unlinked";
  if (!current) return "stale";
  if (milestone.passageRevision !== null && milestone.passageRevision !== current.revision) return "stale";
  if (milestone.passageHash && milestone.passageHash !== current.hash) return "stale";
  return "current";
}

export interface InheritedTrait {
  key: InheritableKey;
  source: "inherited" | "override";
  value: string;
}

function summarizeTextGroup(
  values: Readonly<Record<string, string>> | FoundationProfile | VoiceProfile | BehaviorProfile | CapabilitiesProfile,
): string {
  return Object.entries(values)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
}

function psychologyValue(profile: CharacterDevelopment, key: InheritableKey): string {
  if (key === "importance") return profile.importance ?? "";
  if (key === "narrativeRole") return profile.narrativeRole ?? "";
  if (key === "archetypes") return profile.archetypes.map((item) => item.name).join(", ");
  if (key === "foundation") return summarizeTextGroup(profile.foundation);
  if (key === "voice") return summarizeTextGroup(profile.voice);
  if (key === "behavior") return summarizeTextGroup(profile.behavior);
  if (key === "enneagram") return profile.psychology.enneagram === null ? "" : String(profile.psychology.enneagram);
  if (key === "wing") return profile.psychology.wing === null ? "" : String(profile.psychology.wing);
  return profile.psychology[key];
}

function hasOwnValue(profile: CharacterDevelopment, key: InheritableKey): boolean {
  return psychologyValue(profile, key).trim() !== "";
}

/** Series voice with blank book-override fields filled from the series voice. */
export function effectiveVoice(profile: CharacterDevelopment, bookProjectId: string | null): VoiceProfile {
  if (!bookProjectId) return { ...profile.voice };
  const override = profile.bookVoices.find((item) => item.projectId === bookProjectId)?.voice;
  if (!override) return { ...profile.voice };
  const next = { ...profile.voice };
  for (const key of VOICE_TEXT_KEYS) {
    if (override[key].trim()) next[key] = override[key];
  }
  return next;
}

/**
 * Foundational traits the variant opted into. Local text wins and is marked
 * as an override. Arcs and state changes are always the variant's own.
 */
export function inheritedTraits(variant: CharacterDevelopment, foundation: CharacterDevelopment | null): InheritedTrait[] {
  if (!variant.variant || !foundation) return [];
  const traits: InheritedTrait[] = [];
  for (const key of variant.variant.inheritedKeys) {
    if (hasOwnValue(variant, key)) {
      traits.push({ key, source: "override", value: psychologyValue(variant, key) });
      continue;
    }
    const value = psychologyValue(foundation, key);
    if (value) traits.push({ key, source: "inherited", value });
  }
  return traits;
}

export interface ProfileSuggestion {
  id: string;
  kind: "psychology" | "enneagram" | "wing" | "archetype" | "arc" | "foundation" | "voice";
  key: string;
  value: string;
  evidence: string;
  confidence: "low" | "medium" | "high";
}

export function applyProfileSuggestions(
  profile: CharacterDevelopment,
  accepted: readonly ProfileSuggestion[],
  idFor: (prefix: string) => string,
): CharacterDevelopment {
  const next: CharacterDevelopment = {
    ...profile,
    foundation: { ...profile.foundation },
    voice: { ...profile.voice },
    psychology: { ...profile.psychology, frameworks: [...profile.psychology.frameworks] },
    archetypes: [...profile.archetypes],
    arcs: [...profile.arcs],
    fieldMeta: { ...profile.fieldMeta },
  };
  const stamp = (path: string) => {
    next.fieldMeta[path] = {
      approval: "draft",
      provenance: {
        origin: "extracted",
        note: "Accepted from Extract. Not canon until you approve it.",
        updatedAt: new Date().toISOString(),
      },
    };
  };
  for (const suggestion of accepted) {
    const evidence = suggestion.evidence.trim();
    if (suggestion.kind === "psychology" && (PSYCHOLOGY_TEXT_KEYS as readonly string[]).includes(suggestion.key)) {
      const key = suggestion.key as PsychologyTextKey;
      next.psychology[key] = suggestion.value.trim();
      stamp(`psychology.${key}`);
    } else if (suggestion.kind === "foundation" && (FOUNDATION_TEXT_KEYS as readonly string[]).includes(suggestion.key)) {
      next.foundation[suggestion.key as FoundationTextKey] = suggestion.value.trim();
      stamp(`foundation.${suggestion.key}`);
    } else if (suggestion.kind === "voice" && (VOICE_TEXT_KEYS as readonly string[]).includes(suggestion.key)) {
      next.voice[suggestion.key as VoiceTextKey] = suggestion.value.trim();
      stamp(`voice.${suggestion.key}`);
    } else if (suggestion.kind === "enneagram") {
      const choice = enneagramOf(suggestion.value.trim()) ?? enneagramOf(Number(suggestion.value));
      if (choice) {
        next.psychology.enneagram = choice;
        stamp("psychology.enneagram");
      }
    } else if (suggestion.kind === "wing") {
      const wing = wingOf(Number(suggestion.value));
      if (wing && wingIsValid(next.psychology.enneagram, wing)) {
        next.psychology.wing = wing;
        stamp("psychology.wing");
      }
    } else if (suggestion.kind === "archetype" && suggestion.value.trim()) {
      const name = suggestion.value.trim();
      const rank: ArchetypeRank =
        suggestion.key === "shadow"
          ? "shadow"
          : suggestion.key === "secondary"
            ? "secondary"
            : next.archetypes.some((item) => item.rank === "primary")
              ? "secondary"
              : "primary";
      next.archetypes.push({
        id: idFor("arch"),
        name,
        custom: !(ARCHETYPE_LIBRARY as readonly string[]).includes(name),
        description: evidence,
        rank,
        periodLabel: "",
        relationshipRecordId: null,
        evolvesFromId: null,
        evolutionNote: "",
        bookProjectId: null,
        approval: "draft",
        provenance: { origin: "extracted", note: "Accepted from Extract. Not canon until you approve it." },
      });
    } else if (suggestion.kind === "arc" && suggestion.value.trim()) {
      next.arcs.push({
        id: idFor("arc"),
        title: suggestion.value.trim(),
        description: evidence,
        template: "custom",
        approval: "draft",
        movement: "progressing",
        scope: "series",
        bookProjectId: null,
        parentArcId: null,
        participantRecordIds: [],
        relationId: null,
        perceptions: [],
        startingState: "",
        desiredOutcome: "",
        startingBelief: "",
        emergingTruth: "",
        internalConflict: "",
        externalConflict: "",
        stakes: "",
        notes: "Suggested from the dossier. Not canon until you approve it.",
        milestones: [],
      });
    }
  }
  return next;
}

export interface ReviewObservation {
  check: ReviewCheck;
  summary: string;
  evidence: string;
  uncertainty: string;
  suggestion: string;
}

export function reviewNotesFromObservations(observations: readonly ReviewObservation[], idFor: (prefix: string) => string): ReviewNote[] {
  return observations
    .filter((item) => item.summary.trim())
    .map((item) => ({
      id: idFor("note"),
      check: item.check,
      text: item.suggestion.trim() || item.summary.trim(),
      evidence: item.evidence.trim(),
      uncertainty: item.uncertainty.trim(),
      accepted: false,
    }));
}

export interface DevelopmentCue {
  id: string;
  href: string;
  title: string;
  detail: string;
}

export interface CharacterProfileSource {
  id: string;
  title: string;
  projectId: string;
  profile: CharacterDevelopment;
}

export function cuesForBeats(characters: readonly CharacterProfileSource[], beatIds: ReadonlySet<string>, projectId: string): DevelopmentCue[] {
  return characters.flatMap((character) =>
    character.profile.arcs.flatMap((arc) =>
      arc.milestones
        .filter((milestone) => milestone.weaveBeatId && beatIds.has(milestone.weaveBeatId))
        .map((milestone) => ({
          id: `${character.id}:${milestone.id}`,
          href: dossierHref(character, projectId),
          title: `${character.title}: ${arc.title}`,
          detail: `${milestone.title} · ${milestone.status.replaceAll("_", " ")}`,
        })),
    ),
  );
}

export function cuesForEvents(characters: readonly CharacterProfileSource[], eventIds: ReadonlySet<string>, projectId: string): DevelopmentCue[] {
  return characters.flatMap((character) => {
    const fromArcs = character.profile.arcs.flatMap((arc) =>
      arc.milestones
        .filter((milestone) => milestone.storyEventId && eventIds.has(milestone.storyEventId))
        .map((milestone) => ({
          id: `${character.id}:${milestone.id}`,
          href: dossierHref(character, projectId),
          title: `${character.title}: ${milestone.title}`,
          detail: arc.title,
        })),
    );
    const fromState = character.profile.stateChanges
      .filter((change) => change.storyEventId && eventIds.has(change.storyEventId))
      .map((change) => ({
        id: `${character.id}:${change.id}`,
        href: dossierHref(character, projectId),
        title: `${character.title}: ${change.facet}`,
        detail: change.planned ? "Planned state change" : change.approval,
      }));
    return [...fromArcs, ...fromState];
  });
}

export function cuesForManuscript(
  characters: readonly CharacterProfileSource[],
  manuscriptRecordId: string,
  point: NarrativePoint,
  edges: readonly OrderEdge[],
  projectId: string,
): DevelopmentCue[] {
  return characters.flatMap((character) => {
    const milestones = character.profile.arcs.flatMap((arc) =>
      arc.milestones
        .filter((milestone) => milestone.chapterRecordId === manuscriptRecordId || milestone.sceneRecordId === manuscriptRecordId)
        .map((milestone) => ({
          id: `${character.id}:${milestone.id}`,
          href: dossierHref(character, projectId),
          title: `${character.title}: ${milestone.title}`,
          detail: `${arc.title} · ${milestone.status.replaceAll("_", " ")}`,
        })),
    );
    const state = resolveCharacterState(character.profile, point, edges);
    const facets = STATE_FACETS.flatMap((facet) => {
      const value = state.facets[facet];
      if (value.presence === "unset") return [];
      return [
        {
          id: `${character.id}:state:${facet}`,
          href: dossierHref(character, projectId),
          title: `${character.title}: ${facet}`,
          detail: value.presence === "unknown" ? "Unknown at this point" : value.text,
        },
      ];
    });
    return [...milestones, ...facets];
  });
}

function dossierHref(character: CharacterProfileSource, viewingProjectId: string): string {
  const projectId = character.projectId || viewingProjectId;
  return `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(character.id)}#character-development`;
}

export interface SeriesMatrixRow {
  characterId: string;
  projectId: string;
  title: string;
  importance: ImportanceLevel | null;
  seriesPlanSummary: string;
  books: Array<{
    projectId: string;
    importance: ImportanceLevel | null;
    presence: PresenceState | null;
    arcTitles: string[];
    arcTemplate: ArcTemplate | null;
  }>;
  unresolved: string[];
}

export function seriesMatrix(characters: readonly CharacterProfileSource[], bookIds: readonly string[]): SeriesMatrixRow[] {
  return characters.map((character) => {
    const unresolved = character.profile.arcs
      .filter((arc) => arc.approval === "unresolved" || arc.movement === "paused" || arc.movement === "abandoned")
      .map((arc) => arc.title);
    const plan = character.profile.seriesPlan;
    const seriesPlanSummary =
      plan.overallArc.trim() ||
      plan.longTermGoals.trim() ||
      plan.unresolvedThreads.trim() ||
      "";
    return {
      characterId: character.id,
      projectId: character.projectId,
      title: character.title,
      importance: character.profile.importance,
      seriesPlanSummary,
      books: bookIds.map((projectId) => ({
        projectId,
        importance: character.profile.bookImportance.find((book) => book.projectId === projectId)?.importance ?? null,
        presence: character.profile.bookImportance.find((book) => book.projectId === projectId)?.presence ?? null,
        arcTitles: character.profile.arcs
          .filter((arc) => arc.scope === "series" || arc.bookProjectId === projectId)
          .map((arc) => arc.title),
        arcTemplate: character.profile.bookStates.find((book) => book.projectId === projectId)?.arcTemplate ?? null,
      })),
      unresolved,
    };
  });
}

export function forgottenArcs(profile: CharacterDevelopment): DevelopmentArc[] {
  return profile.arcs.filter(
    (arc) => (arc.approval === "approved" || arc.movement === "progressing") && arc.milestones.length === 0 && arc.movement !== "abandoned",
  );
}

export type ProfileExportMode = "redacted" | "full";

function pushTextGroup(
  lines: string[],
  heading: string,
  values: Readonly<Record<string, string>> | FoundationProfile | VoiceProfile | BehaviorProfile | CapabilitiesProfile | LivedExperienceProfile,
  options?: { prefix?: string; pathRoot?: string; profile?: CharacterDevelopment; canonOnly?: boolean; draftOnly?: boolean },
) {
  const filled = Object.entries(values).filter(([key, value]) => {
    if (typeof value !== "string" || !value.trim()) return false;
    if (!options?.profile || !options.pathRoot) return true;
    if (key === "linkedRecordIds" || key === "approval" || key === "aiVisibility" || key === "provenance") return false;
    const path = `${options.pathRoot}.${key}`;
    const approved = fieldIsEstablishedCanon(options.profile, path);
    if (options.canonOnly) return approved;
    if (options.draftOnly) return !approved;
    return true;
  });
  if (!filled.length) return;
  lines.push("", `## ${heading}`);
  for (const [key, value] of filled) {
    const path = options?.pathRoot ? `${options.pathRoot}.${key}` : "";
    const meta = options?.profile && path ? fieldMetaOf(options.profile, path) : null;
    const label = meta && meta.approval !== "approved" ? `${key} [${meta.approval}]` : key;
    lines.push(`- ${options?.prefix ?? ""}${label}: ${value}`);
  }
}

/**
 * Markdown export for download. Redacted omits lived experience and secrets.
 * Full includes every structured section for local backup.
 */
export function characterProfileMarkdown(
  title: string,
  profile: CharacterDevelopment,
  mode: ProfileExportMode = "redacted",
): string {
  const lines = [`# ${title}`, "", "Writing aid. Not a diagnosis, and not a rule the character must obey.", ""];
  if (profile.importance) lines.push(`Importance: ${profile.importance}`);
  if (profile.narrativeRole) lines.push(`Narrative role: ${profile.narrativeRole.replaceAll("_", " ")}`);
  const seriesBits = SERIES_PLAN_TEXT_KEYS.flatMap((key) =>
    profile.seriesPlan[key].trim() ? [`${key}: ${profile.seriesPlan[key]}`] : [],
  );
  if (seriesBits.length) {
    const heading =
      profile.seriesPlan.approval === "approved" ? "Series development plan (established)" : "Series development plan (draft / planned)";
    lines.push("", `## ${heading}`, ...seriesBits.map((bit) => `- ${bit}`));
  }
  for (const book of profile.bookStates) {
    const bookBits = BOOK_PLAN_TEXT_KEYS.flatMap((key) => (book[key].trim() ? [`${key}: ${book[key]}`] : []));
    if (book.arcTemplate) bookBits.unshift(`arcTemplate: ${book.arcTemplate}`);
    if (bookBits.length) {
      lines.push("", `## Book plan (${book.projectId})`, ...bookBits.map((bit) => `- ${bit}`));
    }
  }
  pushTextGroup(lines, "Identity (established)", profile.foundation, { pathRoot: "foundation", profile, canonOnly: true });
  pushTextGroup(lines, "Identity (draft / proposed)", profile.foundation, { pathRoot: "foundation", profile, draftOnly: true });
  pushTextGroup(lines, "Voice (established)", profile.voice, { pathRoot: "voice", profile, canonOnly: true });
  pushTextGroup(lines, "Voice (draft / proposed)", profile.voice, { pathRoot: "voice", profile, draftOnly: true });
  for (const book of profile.bookVoices) {
    pushTextGroup(lines, `Voice (${book.projectId})`, book.voice);
  }
  pushTextGroup(lines, "Behavior (established)", profile.behavior, { pathRoot: "behavior", profile, canonOnly: true });
  pushTextGroup(lines, "Behavior (draft / proposed)", profile.behavior, { pathRoot: "behavior", profile, draftOnly: true });
  const psych = profile.psychology;
  const establishedPsych: string[] = [];
  const draftPsych: string[] = [];
  if (psych.enneagram) {
    const line = `Enneagram: ${psych.enneagram}${psych.wing ? ` wing ${psych.wing}` : ""}`;
    (fieldIsEstablishedCanon(profile, "psychology.enneagram") ? establishedPsych : draftPsych).push(line);
  }
  for (const key of PSYCHOLOGY_TEXT_KEYS) {
    if (!psych[key]) continue;
    const line = `${key}: ${psych[key]}`;
    (fieldIsEstablishedCanon(profile, `psychology.${key}`) ? establishedPsych : draftPsych).push(line);
  }
  if (establishedPsych.length) lines.push("", "## Psychology (established)", ...establishedPsych.map((line) => `- ${line}`));
  if (draftPsych.length) lines.push("", "## Psychology (draft / proposed)", ...draftPsych.map((line) => `- ${line}`));
  const establishedArchetypes = profile.archetypes.filter((item) => item.approval === "approved");
  const draftArchetypes = profile.archetypes.filter((item) => item.approval !== "approved");
  if (establishedArchetypes.length) {
    lines.push("", "## Archetypes (established)");
    for (const archetype of establishedArchetypes) {
      const period = archetype.periodLabel ? ` (${archetype.periodLabel})` : "";
      const evolution = archetype.evolutionNote ? ` — ${archetype.evolutionNote}` : "";
      lines.push(`- ${archetype.rank}: ${archetype.name}${period}${evolution}`);
    }
  }
  if (draftArchetypes.length) {
    lines.push("", "## Archetypes (draft / proposed)");
    for (const archetype of draftArchetypes) {
      const period = archetype.periodLabel ? ` (${archetype.periodLabel})` : "";
      const evolution = archetype.evolutionNote ? ` — ${archetype.evolutionNote}` : "";
      lines.push(`- ${archetype.rank}: ${archetype.name}${period}${evolution} [${archetype.approval}]`);
    }
  }
  const establishedFrameworks = psych.frameworks.filter((item) => item.approval === "approved");
  const draftFrameworks = psych.frameworks.filter((item) => item.approval !== "approved");
  if (establishedFrameworks.length) {
    lines.push("", "## Personality frameworks (established)");
    for (const framework of establishedFrameworks) {
      lines.push(`- ${framework.name}${framework.notes ? `: ${framework.notes}` : ""}`);
    }
  }
  if (draftFrameworks.length) {
    lines.push("", "## Personality frameworks (draft / proposed)");
    for (const framework of draftFrameworks) {
      lines.push(`- ${framework.name}${framework.notes ? `: ${framework.notes}` : ""} [${framework.approval}]`);
    }
  }
  pushTextGroup(lines, "Capabilities (established)", profile.capabilities, { pathRoot: "capabilities", profile, canonOnly: true });
  pushTextGroup(lines, "Capabilities (draft / proposed)", profile.capabilities, { pathRoot: "capabilities", profile, draftOnly: true });
  if (profile.capabilities.linkedRecordIds.length) {
    lines.push(`- linkedRecordIds: ${profile.capabilities.linkedRecordIds.join(", ")}`);
  }
  if (profile.arcs.length) {
    lines.push("", "## Development");
    for (const arc of profile.arcs) {
      lines.push(`- ${arc.title} (${arc.template}, ${arc.approval}, ${arc.movement}, ${arc.scope})`);
    }
  }
  const knowledge = profile.knowledge.filter((item) => {
    if (mode === "full") return true;
    if (item.kind === "secret") return false;
    if (item.aiVisibility === "omit") return false;
    return true;
  });
  if (knowledge.length) {
    lines.push("", "## Continuity knowledge");
    for (const item of knowledge) {
      lines.push(`- ${item.kind}: ${item.statement} (${item.approval})`);
    }
  }
  if (mode === "full") {
    const lived: Record<string, string> = {};
    for (const key of LIVED_EXPERIENCE_TEXT_KEYS) lived[key] = profile.livedExperience[key];
    pushTextGroup(lines, "Lived experience", lived);
  }
  if (profile.migrationHold.length && mode === "full") {
    lines.push("", "## Migration holds (not canon)");
    for (const held of profile.migrationHold) {
      lines.push(`- [${held.kind}/${held.decision}] ${held.heading}: ${held.text.slice(0, 120)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatFacetSummary(state: ResolvedState): string {
  return STATE_FACETS.flatMap((facet) => {
    const value = state.facets[facet];
    if (value.presence === "unset") return [];
    if (value.presence === "unknown") return [`${facet}: unknown`];
    return [`${facet}: ${value.text}`];
  }).join("; ");
}

function knowledgeLinesForSlice(
  items: readonly KnowledgeItem[],
  slice: ContextSlice,
  holders?: readonly KnowledgeHolder[] | null,
): string[] {
  return items
    .filter((item) => {
      if (item.aiVisibility === "omit") return false;
      if (item.aiVisibility === "spoiler") return slice === "spoiler";
      if (holders && holders.length && !holders.includes(item.holder)) return false;
      return true;
    })
    .map((item) => {
      const plan = item.planned ? " [planned — not established]" : "";
      return `- ${item.kind} (${item.holder})${plan}: ${item.statement}`;
    });
}

function pathIsRepresented(profile: CharacterDevelopment, fieldPath: string): boolean {
  if (fieldPath === "narrativeRole") return !!profile.narrativeRole;
  if (fieldPath === "psychology.enneagram") return profile.psychology.enneagram !== null;
  if (fieldPath === "archetypes") return profile.archetypes.length > 0;
  const [root, key] = fieldPath.split(".");
  if (!root || !key) return false;
  if (root === "foundation" && (FOUNDATION_TEXT_KEYS as readonly string[]).includes(key)) {
    return !!profile.foundation[key as FoundationTextKey].trim();
  }
  if (root === "voice" && (VOICE_TEXT_KEYS as readonly string[]).includes(key)) {
    return !!profile.voice[key as VoiceTextKey].trim();
  }
  if (root === "psychology" && (PSYCHOLOGY_TEXT_KEYS as readonly string[]).includes(key)) {
    return !!profile.psychology[key as PsychologyTextKey].trim();
  }
  if (root === "behavior" && (BEHAVIOR_TEXT_KEYS as readonly string[]).includes(key)) {
    return !!profile.behavior[key as BehaviorTextKey].trim();
  }
  if (root === "livedExperience" && (LIVED_EXPERIENCE_TEXT_KEYS as readonly string[]).includes(key)) {
    return !!profile.livedExperience[key as LivedExperienceTextKey].trim();
  }
  if (root === "capabilities" && (CAPABILITIES_TEXT_KEYS as readonly string[]).includes(key)) {
    return !!profile.capabilities[key as CapabilitiesTextKey].trim();
  }
  return false;
}

/**
 * When body is supplied, omit Markdown sections already represented by filled
 * structured fields so assistant context does not double-count the same facts.
 * Heading recognition is driven from the shared CHARACTER_HEADING_MAP.
 */
export function supplementBodyWithoutStructuredOverlap(body: string, profile: CharacterDevelopment): string {
  const headingHints: Record<string, boolean> = {};
  for (const mapping of CHARACTER_HEADING_MAP) {
    const key = mapping.heading.toLowerCase();
    headingHints[key] = headingHints[key] || pathIsRepresented(profile, mapping.fieldPath);
  }
  headingHints.personality = headingHints.personality || !!profile.psychology.values.trim();
  headingHints.role = headingHints.role || !!profile.foundation.publicRole.trim() || !!profile.narrativeRole;
  const parts = body.split(/\n(?=##\s+)/);
  const kept: string[] = [];
  for (const part of parts) {
    const match = part.match(/^##\s+(.+?)\s*(?:\n|$)([\s\S]*)$/);
    if (!match) {
      if (part.trim()) kept.push(part.trim());
      continue;
    }
    const clean = match[1]!
      .replace(/\[[^\]]+\]/g, "")
      .replace(/[—–-]\s*\w+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (headingHints[clean]) continue;
    kept.push(part.trim());
  }
  return kept.join("\n\n").trim();
}

/**
 * Task-specific character context. Lived experience and omit-secrets stay out
 * of every default slice. Spoiler items appear only when slice is "spoiler".
 * Approved structured fields are preferred; draft/proposed are labeled; holds
 * are never presented as established canon.
 */
export function renderCharacterContextSlice(input: {
  title: string;
  body?: string;
  profile: CharacterDevelopment;
  slice: ContextSlice;
  bookProjectId?: string | null;
  point?: NarrativePoint | null;
  edges?: readonly OrderEdge[];
  passages?: readonly { label: string; excerpt: string }[];
  /** When set, only these knowledge holders appear (character drafting excludes reader-only). */
  knowledgeHolders?: readonly KnowledgeHolder[] | null;
  /** Include approved planned knowledge labeled as plans. Default false. */
  includePlannedKnowledge?: boolean;
}): string {
  const profile = input.profile;
  const voice = effectiveVoice(profile, input.bookProjectId ?? null);
  const point = input.point ?? { bookProjectId: input.bookProjectId ?? null, storyEventId: null, sequence: null };
  const edges = input.edges ?? [];
  const state = resolveCharacterState(profile, point, edges);
  const established = resolveKnowledgeAtPoint(profile, point, edges);
  const planned =
    input.includePlannedKnowledge === true
      ? profile.knowledge.filter((item) => item.approval === "approved" && item.planned)
      : [];
  const knowledge = [...established, ...planned.filter((item) => !established.some((open) => open.id === item.id))];
  const lines: string[] = [`# ${input.title}`];

  if (profile.seriesPlan.approval === "approved") {
    const seriesBits = SERIES_PLAN_TEXT_KEYS.flatMap((key) =>
      profile.seriesPlan[key].trim() ? [`${key}: ${profile.seriesPlan[key]}`] : [],
    );
    if (seriesBits.length) {
      lines.push("", "## Established profile — Series plan", ...seriesBits.map((bit) => `- ${bit}`));
    }
  }

  pushTextGroup(lines, "Established profile — Identity", profile.foundation, {
    pathRoot: "foundation",
    profile,
    canonOnly: true,
  });
  pushTextGroup(lines, "Established profile — Voice", voice, { pathRoot: "voice", profile, canonOnly: true });
  if (input.slice === "dialogue") {
    pushTextGroup(lines, "Established profile — Behavior", profile.behavior, {
      pathRoot: "behavior",
      profile,
      canonOnly: true,
    });
  }
  if (input.slice === "dialogue" || input.slice === "continuity" || input.slice === "spoiler") {
    const psychBits = PSYCHOLOGY_TEXT_KEYS.flatMap((key) =>
      profile.psychology[key] && fieldIsEstablishedCanon(profile, `psychology.${key}`)
        ? [`${key}: ${profile.psychology[key]}`]
        : [],
    );
    if (profile.psychology.enneagram && fieldIsEstablishedCanon(profile, "psychology.enneagram")) {
      psychBits.unshift(
        `Enneagram: ${profile.psychology.enneagram}${profile.psychology.wing ? ` wing ${profile.psychology.wing}` : ""}`,
      );
    }
    for (const framework of profile.psychology.frameworks.filter((item) => item.approval === "approved")) {
      psychBits.push(`${framework.name}${framework.notes ? `: ${framework.notes}` : ""}`);
    }
    if (psychBits.length) lines.push("", "## Established profile — Psychology", ...psychBits.map((bit) => `- ${bit}`));
    const establishedArchetypes = profile.archetypes.filter((item) => item.approval === "approved");
    if (establishedArchetypes.length) {
      lines.push(
        "",
        "## Established profile — Archetypes",
        ...establishedArchetypes.map((item) => {
          const period = item.periodLabel ? ` (${item.periodLabel})` : "";
          const evolution = item.evolutionNote ? ` — ${item.evolutionNote}` : "";
          return `- ${item.rank}: ${item.name}${period}${evolution}`;
        }),
      );
    }
    pushTextGroup(lines, "Established profile — Capabilities", profile.capabilities, {
      pathRoot: "capabilities",
      profile,
      canonOnly: true,
    });
  }

  pushTextGroup(lines, "Draft / Proposed notes (not canon) — Identity", profile.foundation, {
    pathRoot: "foundation",
    profile,
    draftOnly: true,
  });
  pushTextGroup(lines, "Draft / Proposed notes (not canon) — Voice", voice, {
    pathRoot: "voice",
    profile,
    draftOnly: true,
  });
  if (input.slice === "dialogue" || input.slice === "continuity" || input.slice === "spoiler") {
    const draftPsych = PSYCHOLOGY_TEXT_KEYS.flatMap((key) =>
      profile.psychology[key] && !fieldIsEstablishedCanon(profile, `psychology.${key}`)
        ? [`${key}: ${profile.psychology[key]}`]
        : [],
    );
    for (const framework of profile.psychology.frameworks.filter((item) => item.approval !== "approved")) {
      draftPsych.push(`${framework.name}${framework.notes ? `: ${framework.notes}` : ""} [${framework.approval}]`);
    }
    if (draftPsych.length) {
      lines.push("", "## Draft / Proposed notes (not canon) — Psychology", ...draftPsych.map((bit) => `- ${bit}`));
    }
    const draftArchetypes = profile.archetypes.filter((item) => item.approval !== "approved");
    if (draftArchetypes.length) {
      lines.push(
        "",
        "## Draft / Proposed notes (not canon) — Archetypes",
        ...draftArchetypes.map((item) => {
          const period = item.periodLabel ? ` (${item.periodLabel})` : "";
          const evolution = item.evolutionNote ? ` — ${item.evolutionNote}` : "";
          return `- ${item.rank}: ${item.name}${period}${evolution} [${item.approval}]`;
        }),
      );
    }
    pushTextGroup(lines, "Draft / Proposed notes (not canon) — Capabilities", profile.capabilities, {
      pathRoot: "capabilities",
      profile,
      draftOnly: true,
    });
  }

  const facetSummary = formatFacetSummary(state);
  if (facetSummary) lines.push("", `Resolved state: ${facetSummary}`);
  if (input.slice === "continuity" || input.slice === "spoiler") {
    const canonArcs = profile.arcs.filter((arc) => arc.approval === "approved").map((arc) => arc.title);
    const plannedArcs = profile.arcs.filter((arc) => arc.approval !== "approved").map((arc) => arc.title);
    lines.push("", `Canon arcs: ${canonArcs.join(", ") || "(none)"}`);
    lines.push(`Planned arcs (not canon): ${plannedArcs.join(", ") || "(none)"}`);
  }
  const knowLines = knowledgeLinesForSlice(
    knowledge.filter((item) => item.approval === "approved" || input.slice === "spoiler"),
    input.slice,
    input.knowledgeHolders,
  );
  if (knowLines.length) lines.push("", "## Knowledge", ...knowLines);

  if (input.slice === "continuity" || input.slice === "spoiler") {
    const activeMilestones = profile.arcs
      .filter((arc) => arc.approval === "approved")
      .flatMap((arc) =>
        arc.milestones
          .filter((milestone) => milestone.status === "manuscript_confirmed" || milestone.status === "planned")
          .map((milestone) => `- ${arc.title}: ${milestone.title}${milestone.summary ? ` — ${milestone.summary}` : ""}`),
      );
    if (activeMilestones.length) lines.push("", "## Development milestones", ...activeMilestones.slice(0, 24));
  }

  if (input.body?.trim() && input.slice !== "dialogue") {
    const supplement = supplementBodyWithoutStructuredOverlap(input.body, profile);
    if (supplement) lines.push("", "## Dossier prose (unstructured supplement)", supplement);
  }

  const heldNotes = profile.migrationHold.filter(
    (item) => item.kind === "unclassified" || item.kind === "relationships_notes" || item.kind === "continuity_notes",
  );
  if (heldNotes.length && (input.slice === "continuity" || input.slice === "spoiler")) {
    lines.push("", "## Unclassified / held notes (not canon)");
    for (const held of heldNotes.slice(0, 12)) {
      lines.push(`- ${held.heading}: ${held.text.slice(0, 200)}`);
    }
  }

  for (const passage of input.passages ?? []) {
    lines.push("", `## ${passage.label}`, passage.excerpt);
  }
  return lines.join("\n");
}

export interface ProfileFillSuggestion {
  id: string;
  target: "foundation" | "voice" | "psychology";
  key: string;
  value: string;
  heading: string;
}

/**
 * Propose empty-field fills from dossier headings. Uses the shared heading map
 * so panel fill and dossier upgrade cannot diverge.
 */
export function proposeProfileFillFromBody(body: string, profile: CharacterDevelopment): ProfileFillSuggestion[] {
  const suggestions: ProfileFillSuggestion[] = [];
  for (const section of parseMarkdownSections(body)) {
    if (!section.body.trim() || section.cleanHeading === "(preamble)") continue;
    const mapped = SHARED_HEADING_FIELD_MAP.find(
      (item) => item.heading.toLowerCase() === section.cleanHeading.toLowerCase(),
    );
    if (!mapped) continue;
    const current =
      mapped.target === "foundation"
        ? profile.foundation[mapped.key as FoundationTextKey]
        : mapped.target === "voice"
          ? profile.voice[mapped.key as VoiceTextKey]
          : profile.psychology[mapped.key as PsychologyTextKey];
    if (current.trim()) continue;
    suggestions.push({
      id: `fill_${mapped.target}_${mapped.key}`,
      target: mapped.target,
      key: mapped.key,
      value: section.body,
      heading: section.heading,
    });
  }
  return suggestions;
}

export function applyProfileFillSuggestions(
  profile: CharacterDevelopment,
  accepted: readonly ProfileFillSuggestion[],
): CharacterDevelopment {
  const next: CharacterDevelopment = {
    ...profile,
    foundation: { ...profile.foundation },
    voice: { ...profile.voice },
    psychology: { ...profile.psychology, frameworks: [...profile.psychology.frameworks] },
    fieldMeta: { ...profile.fieldMeta },
  };
  const stamp = (path: string, heading: string) => {
    next.fieldMeta[path] = {
      approval: "draft",
      provenance: {
        origin: "imported",
        note: "Filled from dossier heading",
        sourceHeading: heading,
        updatedAt: new Date().toISOString(),
      },
    };
  };
  for (const suggestion of accepted) {
    const value = suggestion.value.trim();
    if (!value) continue;
    if (suggestion.target === "foundation" && (FOUNDATION_TEXT_KEYS as readonly string[]).includes(suggestion.key)) {
      next.foundation[suggestion.key as FoundationTextKey] = value;
      stamp(`foundation.${suggestion.key}`, suggestion.heading);
    } else if (suggestion.target === "voice" && (VOICE_TEXT_KEYS as readonly string[]).includes(suggestion.key)) {
      next.voice[suggestion.key as VoiceTextKey] = value;
      stamp(`voice.${suggestion.key}`, suggestion.heading);
    } else if (suggestion.target === "psychology" && (PSYCHOLOGY_TEXT_KEYS as readonly string[]).includes(suggestion.key)) {
      next.psychology[suggestion.key as PsychologyTextKey] = value;
      stamp(`psychology.${suggestion.key}`, suggestion.heading);
    }
  }
  return next;
}

export function parseProfileSuggestions(value: unknown): { ok: true; suggestions: ProfileSuggestion[] } | { ok: false; message: string } {
  const row = asRecord(value);
  const list = row && Array.isArray(row.suggestions) ? row.suggestions : null;
  if (!list) return { ok: false, message: "The response did not include suggestions." };
  const suggestions: ProfileSuggestion[] = [];
  for (const item of list) {
    const suggestion = asRecord(item);
    if (!suggestion) continue;
    const kind = oneOf(suggestion.kind, ["psychology", "enneagram", "wing", "archetype", "arc", "foundation", "voice"] as const);
    const confidence = oneOf(suggestion.confidence, ["low", "medium", "high"] as const);
    const id = text(suggestion.id);
    const key = text(suggestion.key);
    const suggestionValue = text(suggestion.value);
    if (!kind || !confidence || !id || !suggestionValue) continue;
    if (kind === "psychology" && !(PSYCHOLOGY_TEXT_KEYS as readonly string[]).includes(key)) continue;
    if (kind === "foundation" && !(FOUNDATION_TEXT_KEYS as readonly string[]).includes(key)) continue;
    if (kind === "voice" && !(VOICE_TEXT_KEYS as readonly string[]).includes(key)) continue;
    suggestions.push({
      id,
      kind,
      key,
      value: suggestionValue,
      evidence: text(suggestion.evidence),
      confidence,
    });
  }
  return { ok: true, suggestions };
}

export function parseReviewObservations(value: unknown): { ok: true; observations: ReviewObservation[] } | { ok: false; message: string } {
  const row = asRecord(value);
  const list = row && Array.isArray(row.observations) ? row.observations : null;
  if (!list) return { ok: false, message: "The response did not include observations." };
  const observations: ReviewObservation[] = [];
  for (const item of list) {
    const observation = asRecord(item);
    if (!observation) continue;
    const check = oneOf(observation.check, REVIEW_CHECKS);
    const summary = text(observation.summary);
    if (!check || !summary) continue;
    observations.push({
      check,
      summary,
      evidence: text(observation.evidence),
      uncertainty: text(observation.uncertainty),
      suggestion: text(observation.suggestion),
    });
  }
  return { ok: true, observations };
}

export const PROFILE_SUGGESTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "key", "value", "evidence", "confidence"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["psychology", "enneagram", "wing", "archetype", "arc", "foundation", "voice"] },
          key: { type: "string" },
          value: { type: "string" },
          evidence: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
  },
} as const;

export const REVIEW_OBSERVATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["observations"],
  properties: {
    observations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["check", "summary", "evidence", "uncertainty", "suggestion"],
        properties: {
          check: { type: "string", enum: [...REVIEW_CHECKS] },
          summary: { type: "string" },
          evidence: { type: "string" },
          uncertainty: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
  },
} as const;

export function extractInstructions(): string {
  return [
    "You propose optional character-writing notes from one dossier.",
    "Personality frameworks and Enneagram are writing aids, not clinical diagnoses or behavioural rules.",
    "Keep psychological patterns separate from neurodivergence, trauma, mental health conditions, and lived experience.",
    "Do not infer trauma, disability, neurodivergence, or mental-health conditions.",
    "Do not suggest lived-experience fields or secrets.",
    "You may suggest foundation, voice, psychology, enneagram, archetype (including shadow via key \"shadow\"), or arc notes when the dossier supports them.",
    "Narrative role is not an archetype; do not conflate them.",
    "Every suggestion needs a short evidence quote from the dossier.",
    "If the dossier does not support a field, omit it.",
    "Nothing you return is canon.",
  ].join(" ");
}

export function reviewInstructions(): string {
  return [
    "You review one character at one narrative point.",
    "Cite only the evidence you were given.",
    "Approved arcs and approved state changes are canon. Drafts, proposals, and planned changes are author plans.",
    "Personality profiles and archetypes are optional writing aids, not diagnoses or rules the prose must satisfy.",
    "Do not invent trauma, disability, neurodivergence, mental-health conditions, or secrets.",
    "Say when you are uncertain.",
    "Suggest notes for the author. Do not rewrite manuscript prose.",
  ].join(" ");
}

/** Scoped text for one character. Callers add only the passages they selected. */
export function characterContextText(input: {
  title: string;
  body: string;
  profile: CharacterDevelopment;
  passages: readonly { label: string; excerpt: string }[];
  slice?: ContextSlice;
  bookProjectId?: string | null;
  point?: NarrativePoint | null;
  edges?: readonly OrderEdge[];
}): string {
  return renderCharacterContextSlice({
    title: input.title,
    body: input.body,
    profile: input.profile,
    slice: input.slice ?? (input.passages.length ? "continuity" : "dialogue"),
    bookProjectId: input.bookProjectId ?? null,
    point: input.point,
    edges: input.edges,
    passages: input.passages,
  });
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
