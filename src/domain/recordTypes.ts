export const RECORD_TYPES = [
  "manuscript_chapter",
  "manuscript_scene",
  "scene_note",
  "chapter_outline",
  "story_architecture",
  "character_dossier",
  "worldbuilding",
  "canon_decision",
  "continuity_note",
  "reference_note",
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

export const CONTENT_CLASSES = ["manuscript", "reference"] as const;
export type ContentClass = (typeof CONTENT_CLASSES)[number];

const CONTENT_CLASS_BY_TYPE: Record<RecordType, ContentClass> = {
  manuscript_chapter: "manuscript",
  manuscript_scene: "manuscript",
  scene_note: "reference",
  chapter_outline: "reference",
  story_architecture: "reference",
  character_dossier: "reference",
  worldbuilding: "reference",
  canon_decision: "reference",
  continuity_note: "reference",
  reference_note: "reference",
};

export const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  manuscript_chapter: "Manuscript chapter",
  manuscript_scene: "Manuscript scene",
  scene_note: "Scene note",
  chapter_outline: "Chapter outline",
  story_architecture: "Story architecture",
  character_dossier: "Character dossier",
  worldbuilding: "Worldbuilding",
  canon_decision: "Canon decision",
  continuity_note: "Continuity note",
  reference_note: "Reference note",
};

export function isRecordType(value: string): value is RecordType {
  return (RECORD_TYPES as readonly string[]).includes(value);
}

export function contentClassOf(type: RecordType): ContentClass {
  return CONTENT_CLASS_BY_TYPE[type];
}

export function defaultProtectedFor(type: RecordType): boolean {
  return contentClassOf(type) === "manuscript";
}

export const MANUSCRIPT_TYPES = RECORD_TYPES.filter((t) => contentClassOf(t) === "manuscript");

export function isManuscriptType(type: string): boolean {
  return isRecordType(type) && contentClassOf(type) === "manuscript";
}

/**
 * Types that exist only inside another record: a scene inside a chapter, a
 * note on a chapter or scene. The parent is set when the record is created
 * and never changes. Every other type has no parent.
 */
export const PARENT_TYPES: Partial<Record<RecordType, readonly RecordType[]>> = {
  manuscript_scene: ["manuscript_chapter"],
  scene_note: ["manuscript_chapter", "manuscript_scene"],
};

export function requiresParent(type: RecordType): boolean {
  return PARENT_TYPES[type] !== undefined;
}

export function allowedParent(type: RecordType, parentType: RecordType): boolean {
  return PARENT_TYPES[type]?.includes(parentType) ?? false;
}

/** Reference types that stand on their own: what imports and assistant proposals may create. */
export const STANDALONE_REFERENCE_TYPES = RECORD_TYPES.filter((t) => contentClassOf(t) === "reference" && !requiresParent(t));

/** What a scene or chapter can be linked to in the References panel. */
export function isLinkableReferenceType(type: RecordType): boolean {
  return contentClassOf(type) === "reference" && !requiresParent(type);
}
