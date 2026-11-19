import { listSections, splitStatusTag } from "@/writing/sections";

/*
 * Optional original outlines for World references. They are not document types:
 * a place or a magic system stays Worldbuilding (or whichever type the author
 * chose). Applying an outline only appends empty headings that are not already
 * present. Existing prose, headings, and structured fields are not rewritten.
 */

export const REFERENCE_TEMPLATE_KEYS = [
  "place",
  "religion",
  "culture",
  "organization",
  "species",
  "magic_system",
  "object",
  "language",
] as const;

export type ReferenceTemplateKey = (typeof REFERENCE_TEMPLATE_KEYS)[number];

export interface ReferenceTemplate {
  key: ReferenceTemplateKey;
  label: string;
  sections: readonly string[];
}

export const REFERENCE_TEMPLATES: readonly ReferenceTemplate[] = [
  {
    key: "place",
    label: "Place",
    sections: ["Overview", "Geography", "History", "People", "Notable features", "Open questions"],
  },
  {
    key: "religion",
    label: "Religion",
    sections: ["Overview", "Beliefs", "Practices", "Institutions", "Relations with others", "Open questions"],
  },
  {
    key: "culture",
    label: "Culture",
    sections: ["Overview", "People", "Customs", "Values", "Material life", "Open questions"],
  },
  {
    key: "organization",
    label: "Organization",
    sections: ["Overview", "Purpose", "Structure", "Members", "Resources", "Open questions"],
  },
  {
    key: "species",
    label: "Species",
    sections: ["Overview", "Appearance", "Habitat", "Society", "Abilities", "Open questions"],
  },
  {
    key: "magic_system",
    label: "Magic system",
    sections: ["Overview", "Source", "Rules", "Limits", "Costs", "Practitioners", "Open questions"],
  },
  {
    key: "object",
    label: "Object",
    sections: ["Overview", "Appearance", "Origin", "Use", "History", "Open questions"],
  },
  {
    key: "language",
    label: "Language",
    sections: ["Overview", "Speakers", "Sound", "Grammar notes", "Writing", "Sample phrases", "Open questions"],
  },
];

const BY_KEY = new Map(REFERENCE_TEMPLATES.map((t) => [t.key, t]));

export function isReferenceTemplateKey(value: string): value is ReferenceTemplateKey {
  return (REFERENCE_TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function referenceTemplate(key: ReferenceTemplateKey): ReferenceTemplate {
  const found = BY_KEY.get(key);
  if (!found) throw new Error(`Unknown outline ${key}`);
  return found;
}

export interface TemplateMapping {
  templateKey: ReferenceTemplateKey;
  templateLabel: string;
  /** Headings already in the document, matched by title. Their text is kept. */
  matched: Array<{ templateSection: string; heading: string }>;
  /** Headings that are not part of this outline. Kept word for word. */
  keptHeadings: string[];
  /** True when the document has text before its first heading, or no headings at all. */
  freeformKept: boolean;
  /** Outline headings that would be appended, empty. */
  missing: string[];
  /** Structured-field keys. Apply never adds, changes, or removes them. */
  fieldKeys: string[];
  /** Saved body with missing headings appended. Identical to the saved body when nothing is missing. */
  proposedBody: string;
  changesBody: boolean;
}

export function normalizeOutlineTitle(title: string): string {
  const { title: bare } = splitStatusTag(title);
  return bare.normalize("NFC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/** Empty `##` headings, for a new World reference the author left blank. */
export function scaffoldBody(template: ReferenceTemplate): string {
  return template.sections.map((section) => `## ${section}\n`).join("\n");
}

function appendMissing(body: string, missing: readonly string[]): string {
  if (!missing.length) return body;
  const block = missing.map((section) => `## ${section}\n`).join("\n");
  if (!body) return block;
  const sep = body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
  return body + sep + block;
}

/**
 * Reviewed mapping. Does not write. Existing text stays a prefix of the
 * proposed body; unknown headings and every field key are reported as kept.
 */
export function reviewTemplateMapping(template: ReferenceTemplate, body: string, fieldKeys: readonly string[]): TemplateMapping {
  const sections = listSections(body);
  const used = new Set<number>();
  const matched: TemplateMapping["matched"] = [];
  const missing: string[] = [];
  for (const name of template.sections) {
    const want = normalizeOutlineTitle(name);
    const index = sections.findIndex((section, i) => !used.has(i) && normalizeOutlineTitle(section.title) === want);
    if (index === -1) missing.push(name);
    else {
      used.add(index);
      matched.push({ templateSection: name, heading: sections[index]!.title });
    }
  }
  const keptHeadings = sections.filter((_, i) => !used.has(i)).map((section) => section.title);
  const proposedBody = appendMissing(body, missing);
  return {
    templateKey: template.key,
    templateLabel: template.label,
    matched,
    keptHeadings,
    freeformKept: body.length > 0 && (sections.length === 0 || sections[0]!.start > 0),
    missing,
    fieldKeys: [...fieldKeys],
    proposedBody,
    changesBody: proposedBody !== body,
  };
}
