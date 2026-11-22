/**
 * Shared Markdown heading recognition for Living Profile fill and dossier
 * upgrade. One map, one section parser — panel fill and upgrade must not drift.
 */

export type HeadingFillTarget = "foundation" | "voice" | "psychology" | "behavior" | "livedExperience" | "capabilities";

export type UpgradeDestination =
  | "identity"
  | "psychology"
  | "voice"
  | "behavior"
  | "lived"
  | "relationships"
  | "capabilities"
  | "development"
  | "continuity"
  | "historical_amendments"
  | "protected_unknowns"
  | "proposed_unapproved"
  | "unclassified";

export type UpgradeConfidence = "high" | "medium" | "low";

export interface HeadingFieldMapping {
  heading: string;
  destination: UpgradeDestination;
  fieldPath: string;
  confidence: UpgradeConfidence;
  /** When set, this mapping may fill an empty structured text field. */
  fillTarget?: HeadingFillTarget;
  fillKey?: string;
}

/**
 * Canonical heading → destination / field map. Upgrade and lightweight fill
 * both read this list. Lived/trauma headings are classified but never
 * auto-approved by callers.
 */
export const CHARACTER_HEADING_MAP: ReadonlyArray<HeadingFieldMapping> = [
  { heading: "Appearance", destination: "identity", fieldPath: "foundation.appearance", confidence: "high", fillTarget: "foundation", fillKey: "appearance" },
  { heading: "Physical characteristics", destination: "identity", fieldPath: "foundation.physicalCharacteristics", confidence: "high", fillTarget: "foundation", fillKey: "physicalCharacteristics" },
  { heading: "Pronouns", destination: "identity", fieldPath: "foundation.pronouns", confidence: "high", fillTarget: "foundation", fillKey: "pronouns" },
  { heading: "Ancestry", destination: "identity", fieldPath: "foundation.ancestry", confidence: "high", fillTarget: "foundation", fillKey: "ancestry" },
  { heading: "Age", destination: "identity", fieldPath: "foundation.lifeStage", confidence: "medium", fillTarget: "foundation", fillKey: "lifeStage" },
  { heading: "Life stage", destination: "identity", fieldPath: "foundation.lifeStage", confidence: "high", fillTarget: "foundation", fillKey: "lifeStage" },
  { heading: "Role", destination: "identity", fieldPath: "foundation.publicRole", confidence: "high", fillTarget: "foundation", fillKey: "publicRole" },
  { heading: "Public role", destination: "identity", fieldPath: "foundation.publicRole", confidence: "high", fillTarget: "foundation", fillKey: "publicRole" },
  { heading: "Private self", destination: "identity", fieldPath: "foundation.privateSelf", confidence: "high", fillTarget: "foundation", fillKey: "privateSelf" },
  { heading: "Occupation", destination: "identity", fieldPath: "foundation.occupation", confidence: "high", fillTarget: "foundation", fillKey: "occupation" },
  { heading: "Culture", destination: "identity", fieldPath: "foundation.culturalIdentity", confidence: "high", fillTarget: "foundation", fillKey: "culturalIdentity" },
  { heading: "Cultural identity", destination: "identity", fieldPath: "foundation.culturalIdentity", confidence: "high", fillTarget: "foundation", fillKey: "culturalIdentity" },
  { heading: "Background", destination: "identity", fieldPath: "foundation.formativeBackground", confidence: "high", fillTarget: "foundation", fillKey: "formativeBackground" },
  { heading: "Goals", destination: "identity", fieldPath: "foundation.externalGoal", confidence: "high", fillTarget: "foundation", fillKey: "externalGoal" },
  { heading: "External goal", destination: "identity", fieldPath: "foundation.externalGoal", confidence: "high", fillTarget: "foundation", fillKey: "externalGoal" },
  { heading: "Personality", destination: "psychology", fieldPath: "psychology.values", confidence: "medium", fillTarget: "psychology", fillKey: "values" },
  { heading: "Desire", destination: "psychology", fieldPath: "psychology.coreDesire", confidence: "high", fillTarget: "psychology", fillKey: "coreDesire" },
  { heading: "Core desire", destination: "psychology", fieldPath: "psychology.coreDesire", confidence: "high", fillTarget: "psychology", fillKey: "coreDesire" },
  { heading: "Fear", destination: "psychology", fieldPath: "psychology.coreFear", confidence: "high", fillTarget: "psychology", fillKey: "coreFear" },
  { heading: "Core fear", destination: "psychology", fieldPath: "psychology.coreFear", confidence: "high", fillTarget: "psychology", fillKey: "coreFear" },
  { heading: "Motivation", destination: "psychology", fieldPath: "psychology.coreMotivation", confidence: "high", fillTarget: "psychology", fillKey: "coreMotivation" },
  { heading: "Core motivation", destination: "psychology", fieldPath: "psychology.coreMotivation", confidence: "high", fillTarget: "psychology", fillKey: "coreMotivation" },
  { heading: "Wants", destination: "psychology", fieldPath: "psychology.consciousWants", confidence: "high", fillTarget: "psychology", fillKey: "consciousWants" },
  { heading: "External want", destination: "psychology", fieldPath: "psychology.consciousWants", confidence: "high", fillTarget: "psychology", fillKey: "consciousWants" },
  { heading: "External wants", destination: "psychology", fieldPath: "psychology.consciousWants", confidence: "high", fillTarget: "psychology", fillKey: "consciousWants" },
  { heading: "Needs", destination: "psychology", fieldPath: "psychology.unconsciousNeeds", confidence: "medium", fillTarget: "psychology", fillKey: "unconsciousNeeds" },
  { heading: "Internal need", destination: "psychology", fieldPath: "psychology.unconsciousNeeds", confidence: "high", fillTarget: "psychology", fillKey: "unconsciousNeeds" },
  { heading: "Internal needs", destination: "psychology", fieldPath: "psychology.unconsciousNeeds", confidence: "high", fillTarget: "psychology", fillKey: "unconsciousNeeds" },
  { heading: "Misbelief", destination: "psychology", fieldPath: "psychology.internalMisbelief", confidence: "high", fillTarget: "psychology", fillKey: "internalMisbelief" },
  { heading: "Wound", destination: "psychology", fieldPath: "psychology.emotionalWound", confidence: "medium", fillTarget: "psychology", fillKey: "emotionalWound" },
  { heading: "Values", destination: "psychology", fieldPath: "psychology.values", confidence: "high", fillTarget: "psychology", fillKey: "values" },
  { heading: "Moral boundaries", destination: "psychology", fieldPath: "psychology.moralBoundaries", confidence: "high", fillTarget: "psychology", fillKey: "moralBoundaries" },
  { heading: "Defense mechanisms", destination: "psychology", fieldPath: "psychology.defenceMechanisms", confidence: "high", fillTarget: "psychology", fillKey: "defenceMechanisms" },
  { heading: "Defence mechanisms", destination: "psychology", fieldPath: "psychology.defenceMechanisms", confidence: "high", fillTarget: "psychology", fillKey: "defenceMechanisms" },
  { heading: "Stress responses", destination: "psychology", fieldPath: "psychology.stressBehavior", confidence: "high", fillTarget: "psychology", fillKey: "stressBehavior" },
  { heading: "Under stress", destination: "psychology", fieldPath: "psychology.stressBehavior", confidence: "high", fillTarget: "psychology", fillKey: "stressBehavior" },
  { heading: "Growth responses", destination: "psychology", fieldPath: "psychology.secureBehavior", confidence: "high", fillTarget: "psychology", fillKey: "secureBehavior" },
  { heading: "When secure", destination: "psychology", fieldPath: "psychology.secureBehavior", confidence: "high", fillTarget: "psychology", fillKey: "secureBehavior" },
  { heading: "Strengths", destination: "psychology", fieldPath: "psychology.strengths", confidence: "high", fillTarget: "psychology", fillKey: "strengths" },
  { heading: "Weaknesses", destination: "psychology", fieldPath: "psychology.weaknesses", confidence: "high", fillTarget: "psychology", fillKey: "weaknesses" },
  { heading: "Blind spots", destination: "psychology", fieldPath: "psychology.blindSpots", confidence: "high", fillTarget: "psychology", fillKey: "blindSpots" },
  { heading: "Contradictions", destination: "psychology", fieldPath: "psychology.contradictions", confidence: "high", fillTarget: "psychology", fillKey: "contradictions" },
  { heading: "Emotional triggers", destination: "psychology", fieldPath: "psychology.emotionalTriggers", confidence: "high", fillTarget: "psychology", fillKey: "emotionalTriggers" },
  { heading: "Behavioral patterns", destination: "psychology", fieldPath: "psychology.behavioralPatterns", confidence: "high", fillTarget: "psychology", fillKey: "behavioralPatterns" },
  { heading: "Behavioural patterns", destination: "psychology", fieldPath: "psychology.behavioralPatterns", confidence: "high", fillTarget: "psychology", fillKey: "behavioralPatterns" },
  { heading: "Attachment", destination: "psychology", fieldPath: "psychology.attachmentTendencies", confidence: "medium", fillTarget: "psychology", fillKey: "attachmentTendencies" },
  { heading: "Attachment patterns", destination: "psychology", fieldPath: "psychology.attachmentTendencies", confidence: "high", fillTarget: "psychology", fillKey: "attachmentTendencies" },
  { heading: "Relationship patterns", destination: "psychology", fieldPath: "psychology.attachmentTendencies", confidence: "medium", fillTarget: "psychology", fillKey: "attachmentTendencies" },
  { heading: "Coping strategies", destination: "psychology", fieldPath: "psychology.copingStrategies", confidence: "high", fillTarget: "psychology", fillKey: "copingStrategies" },
  { heading: "Self-perception", destination: "psychology", fieldPath: "psychology.selfPerception", confidence: "high", fillTarget: "psychology", fillKey: "selfPerception" },
  { heading: "Self perception", destination: "psychology", fieldPath: "psychology.selfPerception", confidence: "high", fillTarget: "psychology", fillKey: "selfPerception" },
  { heading: "External perception", destination: "psychology", fieldPath: "psychology.externalPerception", confidence: "high", fillTarget: "psychology", fillKey: "externalPerception" },
  { heading: "Enneagram", destination: "psychology", fieldPath: "psychology.enneagram", confidence: "high" },
  { heading: "Archetype", destination: "psychology", fieldPath: "archetypes", confidence: "medium" },
  { heading: "Archetypes", destination: "psychology", fieldPath: "archetypes", confidence: "high" },
  { heading: "Primary archetype", destination: "psychology", fieldPath: "archetypes", confidence: "high" },
  { heading: "Secondary archetype", destination: "psychology", fieldPath: "archetypes", confidence: "high" },
  { heading: "Shadow archetype", destination: "psychology", fieldPath: "archetypes", confidence: "high" },
  { heading: "Narrative role", destination: "identity", fieldPath: "narrativeRole", confidence: "high" },
  { heading: "Voice", destination: "voice", fieldPath: "voice.diction", confidence: "high", fillTarget: "voice", fillKey: "diction" },
  { heading: "Diction", destination: "voice", fieldPath: "voice.diction", confidence: "high", fillTarget: "voice", fillKey: "diction" },
  { heading: "Dialogue", destination: "voice", fieldPath: "voice.exampleDialogue", confidence: "high", fillTarget: "voice", fillKey: "exampleDialogue" },
  { heading: "Speech", destination: "voice", fieldPath: "voice.speechPatterns", confidence: "high", fillTarget: "voice", fillKey: "speechPatterns" },
  { heading: "Speech patterns", destination: "voice", fieldPath: "voice.speechPatterns", confidence: "high", fillTarget: "voice", fillKey: "speechPatterns" },
  { heading: "Humor", destination: "voice", fieldPath: "voice.humor", confidence: "high", fillTarget: "voice", fillKey: "humor" },
  { heading: "Internal narrative", destination: "voice", fieldPath: "voice.internalNarrative", confidence: "high", fillTarget: "voice", fillKey: "internalNarrative" },
  { heading: "Habits", destination: "behavior", fieldPath: "behavior.habits", confidence: "high", fillTarget: "behavior", fillKey: "habits" },
  { heading: "Learned behavior", destination: "behavior", fieldPath: "behavior.habits", confidence: "medium", fillTarget: "behavior", fillKey: "habits" },
  { heading: "Learned behaviour", destination: "behavior", fieldPath: "behavior.habits", confidence: "medium", fillTarget: "behavior", fillKey: "habits" },
  { heading: "Mannerisms", destination: "behavior", fieldPath: "behavior.mannerisms", confidence: "high", fillTarget: "behavior", fillKey: "mannerisms" },
  { heading: "Under pressure", destination: "behavior", fieldPath: "behavior.underPressure", confidence: "high", fillTarget: "behavior", fillKey: "underPressure" },
  { heading: "Social behavior", destination: "behavior", fieldPath: "behavior.socialBehavior", confidence: "high", fillTarget: "behavior", fillKey: "socialBehavior" },
  { heading: "Behavior", destination: "behavior", fieldPath: "behavior.habits", confidence: "medium", fillTarget: "behavior", fillKey: "habits" },
  { heading: "Lived experience", destination: "lived", fieldPath: "livedExperience.formativeExperiences", confidence: "high", fillTarget: "livedExperience", fillKey: "formativeExperiences" },
  { heading: "Formative experience", destination: "lived", fieldPath: "livedExperience.formativeExperiences", confidence: "high", fillTarget: "livedExperience", fillKey: "formativeExperiences" },
  { heading: "Formative experiences", destination: "lived", fieldPath: "livedExperience.formativeExperiences", confidence: "high", fillTarget: "livedExperience", fillKey: "formativeExperiences" },
  { heading: "Trauma", destination: "lived", fieldPath: "livedExperience.trauma", confidence: "high", fillTarget: "livedExperience", fillKey: "trauma" },
  { heading: "Neurodivergence", destination: "lived", fieldPath: "livedExperience.neurodivergence", confidence: "high", fillTarget: "livedExperience", fillKey: "neurodivergence" },
  { heading: "Disability", destination: "lived", fieldPath: "livedExperience.disability", confidence: "high", fillTarget: "livedExperience", fillKey: "disability" },
  { heading: "Mental health", destination: "lived", fieldPath: "livedExperience.boundaryNote", confidence: "medium", fillTarget: "livedExperience", fillKey: "boundaryNote" },
  { heading: "Mental health conditions", destination: "lived", fieldPath: "livedExperience.boundaryNote", confidence: "medium", fillTarget: "livedExperience", fillKey: "boundaryNote" },
  { heading: "Coping", destination: "lived", fieldPath: "livedExperience.coping", confidence: "high", fillTarget: "livedExperience", fillKey: "coping" },
  { heading: "Portrayal", destination: "lived", fieldPath: "livedExperience.portrayalGuidance", confidence: "high", fillTarget: "livedExperience", fillKey: "portrayalGuidance" },
  { heading: "Portrayal guidance", destination: "lived", fieldPath: "livedExperience.portrayalGuidance", confidence: "high", fillTarget: "livedExperience", fillKey: "portrayalGuidance" },
  { heading: "Relationships", destination: "relationships", fieldPath: "hold.relationships", confidence: "medium" },
  { heading: "Allies", destination: "relationships", fieldPath: "hold.relationships", confidence: "medium" },
  { heading: "Enemies", destination: "relationships", fieldPath: "hold.relationships", confidence: "medium" },
  { heading: "Skills", destination: "capabilities", fieldPath: "capabilities.skills", confidence: "high", fillTarget: "capabilities", fillKey: "skills" },
  { heading: "Abilities", destination: "capabilities", fieldPath: "capabilities.skills", confidence: "medium", fillTarget: "capabilities", fillKey: "skills" },
  { heading: "Limitations", destination: "capabilities", fieldPath: "capabilities.limitations", confidence: "high", fillTarget: "capabilities", fillKey: "limitations" },
  { heading: "Magic", destination: "capabilities", fieldPath: "capabilities.magicalAbilities", confidence: "high", fillTarget: "capabilities", fillKey: "magicalAbilities" },
  { heading: "Equipment", destination: "capabilities", fieldPath: "capabilities.equipment", confidence: "high", fillTarget: "capabilities", fillKey: "equipment" },
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

/** Lightweight panel fill: only foundation / voice / psychology empty-field targets. */
export const CHARACTER_HEADING_FIELD_MAP: ReadonlyArray<{
  heading: string;
  target: "foundation" | "voice" | "psychology";
  key: string;
}> = CHARACTER_HEADING_MAP.filter(
  (item): item is HeadingFieldMapping & { fillTarget: "foundation" | "voice" | "psychology"; fillKey: string } =>
    item.fillTarget === "foundation" || item.fillTarget === "voice" || item.fillTarget === "psychology",
).map((item) => ({
  heading: item.heading,
  target: item.fillTarget,
  key: item.fillKey,
}));

export interface MarkdownSection {
  heading: string;
  cleanHeading: string;
  body: string;
  startOffset: number;
  endOffset: number;
  tags: string[];
}

const STATUS_TAG_RE =
  /\[(APPROVED(?:\s+FRAMEWORK)?|PROPOSED|DRAFT|UNKNOWN|PROTECTED|SUPERSEDED|UNRESOLVED|SELECTED)\]/gi;
const EM_DASH_STATUS_RE = /[—–-]\s*(SELECTED|PROPOSED|DRAFT|UNKNOWN|PROTECTED)\b/gi;

export function extractHeadingTags(heading: string): string[] {
  const tags: string[] = [];
  for (const match of heading.matchAll(STATUS_TAG_RE)) {
    tags.push(match[1]!.toUpperCase().replace(/\s+/g, " "));
  }
  for (const match of heading.matchAll(EM_DASH_STATUS_RE)) {
    tags.push(match[1]!.toUpperCase());
  }
  return tags;
}

export function cleanHeadingText(heading: string): string {
  return heading
    .replace(STATUS_TAG_RE, "")
    .replace(EM_DASH_STATUS_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

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
    sections.push({
      heading,
      cleanHeading: cleanHeadingText(heading),
      body: (match[2] ?? "").trim(),
      startOffset,
      endOffset,
      tags: extractHeadingTags(heading),
    });
  }
  return sections;
}

export function findHeadingMapping(cleanHeading: string): HeadingFieldMapping | undefined {
  const lower = cleanHeading.toLowerCase();
  return CHARACTER_HEADING_MAP.find((item) => item.heading.toLowerCase() === lower);
}
