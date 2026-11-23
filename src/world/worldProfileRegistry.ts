/**
 * Client-safe Living World Profile definition registry.
 * Built-in kinds map flat WORLD_KIND_FIELD_SPECS without duplicating values into
 * worldProfile.values. Custom WorldKindTemplate specs add typed fields/collections.
 * No DB imports — callers pass available template views.
 */

import type {
  WorldProfile,
  WorldProfileCalendarDate,
  WorldProfileFieldValue,
  WorldProfileProblem,
} from "@/domain/worldProfile";
import { readWorldProfileFieldValue } from "@/domain/worldProfile";
import type { KindTemplateField, KindTemplateView } from "@/world/kindTemplates";
import { WORLD_TAXONOMY_CATEGORIES, type TaxonomyCategoryId } from "@/world/taxonomy";
import {
  WORLD_KIND_FIELD_SPECS,
  worldbuildingKindFromFields,
  worldbuildingKindRaw,
} from "@/world/worldKinds";
import { WORLD_KIND_KEYS, type WorldKindKey } from "@/world/referenceTemplates";

export const WORLD_PROFILE_FIELD_TYPES = [
  "short_text",
  "long_text",
  "number",
  "boolean",
  "select",
  "multi_select",
  "calendar_date",
  "record_ref",
  "record_refs",
  "ordered_list",
] as const;
export type WorldProfileFieldType = (typeof WORLD_PROFILE_FIELD_TYPES)[number];

export type WorldProfileFieldStorage = "flat" | "profile";

export interface WorldProfileFieldOption {
  id: string;
  label: string;
}

export interface WorldProfileFieldDef {
  key: string;
  label: string;
  description?: string;
  type: WorldProfileFieldType;
  /** flat = top-level fields[key]; profile = worldProfile.values[key]. */
  storage: WorldProfileFieldStorage;
  multiline?: boolean;
  optional?: boolean;
  options?: readonly WorldProfileFieldOption[];
  placeholder?: string;
}

export interface WorldProfileCollectionDef {
  key: string;
  label: string;
  description?: string;
  fields: readonly WorldProfileFieldDef[];
}

export interface WorldProfileDefinition {
  id: string;
  label: string;
  description: string;
  /** Built-in kind key when this definition mirrors WORLD_KIND_FIELD_SPECS. */
  kindKey?: WorldKindKey;
  categorySlug?: string;
  subcategorySlug?: string;
  fields: readonly WorldProfileFieldDef[];
  collections: readonly WorldProfileCollectionDef[];
  /** When loaded from a sibling book template. */
  homeProjectId?: string | null;
  homeLabel?: string | null;
  source: "builtin" | "template";
  templateId?: string;
  kind?: string;
}

/**
 * Non-character Hub categories that ship a Living World Profile definition.
 * Characters stay on `fields.characterDevelopment`.
 */
export const WORLD_PROFILE_CATEGORY_IDS = [
  "geography",
  "locations",
  "magic",
  "peoples",
  "cultures",
  "religion",
  "organizations",
  "languages",
  "history",
  "economy",
  "technology",
  "objects",
  "law",
] as const satisfies readonly TaxonomyCategoryId[];

export type WorldProfileCategoryId = (typeof WORLD_PROFILE_CATEGORY_IDS)[number];

function profileField(
  key: string,
  label: string,
  type: WorldProfileFieldType,
  description?: string,
): WorldProfileFieldDef {
  return {
    key,
    label,
    type,
    storage: "profile",
    optional: true,
    multiline: type === "long_text",
    description,
  };
}

/**
 * Category definitions reuse flat WORLD_KIND_FIELD_SPECS where a kind already
 * owns the concept (climate, goal, speakers, …). New keys are profile-only.
 */
const CATEGORY_BASELINE_FIELDS: Record<WorldProfileCategoryId, readonly WorldProfileFieldDef[]> = {
  geography: [
    ...builtinFlatFields("place"),
    profileField("terrain", "Terrain", "long_text", "Landforms, ground cover, and physical character."),
    profileField("boundaries", "Boundaries", "long_text", "Borders, frontiers, and edges of the region."),
    profileField("waterways", "Waterways", "long_text", "Rivers, coasts, lakes, and crossings."),
    profileField("travelConstraints", "Travel constraints", "long_text", "Passes, seasons, hazards, and routes."),
  ],
  locations: [
    ...builtinFlatFields("place"),
    profileField("layout", "Layout", "long_text", "Rooms, wings, floors, and how space is arranged."),
    profileField("atmosphere", "Atmosphere", "long_text", "Mood, sensory detail, and feel of the place."),
    profileField("access", "Access", "long_text", "How people enter, leave, or are kept out."),
    profileField("uses", "Uses", "long_text", "What the place is for day to day."),
    profileField("distinctiveFeatures", "Distinctive features", "long_text", "Details that make it recognizable."),
  ],
  magic: [
    ...builtinFlatFields("magic_system"),
    profileField("workings", "Workings", "long_text", "How the magic is performed or operates."),
    profileField("costs", "Costs", "long_text", "Price, toll, or consequence of use."),
    profileField("exceptions", "Exceptions", "long_text", "Cases that break the usual rules."),
  ],
  peoples: [
    ...builtinFlatFields("species"),
    profileField("ancestry", "Ancestry", "long_text", "Heritage, bloodlines, and origin stories."),
    profileField("physiology", "Physiology", "long_text", "Bodies, senses, and biology."),
    profileField("lifespan", "Lifespan", "short_text", "Typical age span or life stages."),
    profileField("variation", "Variation within a population", "long_text", "How individuals differ."),
  ],
  cultures: [
    ...builtinFlatFields("culture"),
    profileField("values", "Values", "long_text", "What the culture prizes or forbids."),
    profileField("customs", "Customs", "long_text", "Everyday practices and traditions."),
    profileField("etiquette", "Etiquette", "long_text", "Courtesy, taboos, and social expectations."),
    profileField("socialStructures", "Social structures", "long_text", "Classes, castes, roles, and kinship."),
    profileField("regionalVariation", "Regional variation", "long_text", "How customs differ by place."),
  ],
  religion: [
    ...builtinFlatFields("religion"),
    profileField("beliefs", "Beliefs", "long_text", "Doctrine, cosmology, and core tenets."),
    profileField("denominations", "Denominations", "long_text", "Sects, orders, and internal branches."),
    profileField("rituals", "Rituals", "long_text", "Rites, observances, and ceremonies."),
    profileField("sacredPlaces", "Sacred places", "long_text", "Temples, shrines, and holy ground."),
    profileField("internalDisputes", "Internal disputes", "long_text", "Schisms, controversies, and debates."),
  ],
  organizations: [
    ...builtinFlatFields("organization"),
    profileField("leadershipStructure", "Leadership structure", "long_text", "Ranks, councils, and decision paths."),
    profileField("membership", "Membership", "long_text", "Who belongs and how people join."),
    profileField("resources", "Resources", "long_text", "Wealth, holdings, and capabilities."),
    profileField("influence", "Influence", "long_text", "Reach, allies, and political weight."),
  ],
  languages: [
    ...builtinFlatFields("language"),
    profileField("pronunciation", "Pronunciation", "long_text", "Sounds, stress, and speaking notes."),
    profileField("grammar", "Grammar", "long_text", "Word order, morphology, and structure."),
    profileField("namingConventions", "Naming conventions", "long_text", "How people and places are named."),
  ],
  history: [
    profileField("period", "Period", "short_text", "Era name or span of the event."),
    profileField("date", "Date", "calendar_date", "Story-calendar date or freeform date text."),
    profileField("participants", "Participants", "long_text", "People, peoples, and factions involved."),
    profileField("causes", "Causes", "long_text", "What led to the event."),
    profileField("consequences", "Consequences", "long_text", "Outcomes and lasting effects."),
    profileField(
      "timelineEvents",
      "Timeline event notes",
      "ordered_list",
      "Titles or record IDs of related story-timeline events (picker UI deferred).",
    ),
  ],
  economy: [
    profileField("currencies", "Currencies", "long_text", "Money, credit, and units of exchange."),
    profileField("trade", "Trade", "long_text", "Routes, markets, and exchange patterns."),
    profileField("resources", "Resources", "long_text", "Raw materials and scarce goods."),
    profileField("professions", "Professions", "long_text", "Common work and specialized trades."),
    profileField("economicPressures", "Economic pressures", "long_text", "Famines, tariffs, shortages, and shocks."),
  ],
  technology: [
    profileField("purpose", "Purpose", "long_text", "What the technology is for."),
    profileField("operatingRequirements", "Operating requirements", "long_text", "Fuel, skill, conditions, and upkeep."),
    profileField("availability", "Availability", "long_text", "Who can obtain or afford it."),
    profileField("limitations", "Limitations", "long_text", "Failure modes and hard constraints."),
  ],
  objects: [
    ...builtinFlatFields("object"),
    profileField("appearance", "Appearance", "long_text", "Look, materials, and distinctive marks."),
    profileField("function", "Function", "long_text", "What it does when used."),
    profileField("ownership", "Ownership", "long_text", "Who claims or controls it beyond the current holder."),
    profileField("significance", "Significance", "long_text", "Symbolic, plot, or cultural weight."),
  ],
  law: [
    profileField("jurisdiction", "Jurisdiction", "short_text", "Where the rule applies."),
    profileField("provisions", "Provisions", "long_text", "What the law requires or forbids."),
    profileField("enforcement", "Enforcement", "long_text", "Who enforces it and how."),
    profileField("exceptions", "Exceptions", "long_text", "Exemptions and edge cases."),
    profileField("affectedGroups", "Affected groups", "long_text", "Who is bound or protected."),
  ],
};

function builtinFlatFields(kind: WorldKindKey): WorldProfileFieldDef[] {
  return WORLD_KIND_FIELD_SPECS[kind].map((spec) => ({
    key: spec.key,
    label: spec.label,
    type: spec.multiline ? "long_text" : "short_text",
    storage: "flat" as const,
    multiline: spec.multiline === true,
    optional: true,
    placeholder: spec.placeholder,
  }));
}

function builtinKindDefinition(kind: WorldKindKey): WorldProfileDefinition {
  const labels: Record<WorldKindKey, string> = {
    place: "Place",
    religion: "Religion",
    culture: "Culture",
    organization: "Organization",
    species: "Species",
    magic_system: "Magic system",
    object: "Object",
    language: "Language",
  };
  const categoryByKind: Record<WorldKindKey, TaxonomyCategoryId> = {
    place: "locations",
    religion: "religion",
    culture: "cultures",
    organization: "organizations",
    species: "peoples",
    magic_system: "magic",
    object: "objects",
    language: "languages",
  };
  return {
    id: `builtin:${kind}`,
    label: labels[kind],
    description: `Built-in ${labels[kind].toLowerCase()} profile fields.`,
    kindKey: kind,
    categorySlug: categoryByKind[kind],
    fields: builtinFlatFields(kind),
    collections: [],
    source: "builtin",
  };
}

function isWorldProfileCategoryId(value: string): value is WorldProfileCategoryId {
  return (WORLD_PROFILE_CATEGORY_IDS as readonly string[]).includes(value);
}

function builtinCategoryDefinition(categoryId: WorldProfileCategoryId): WorldProfileDefinition | null {
  const category = WORLD_TAXONOMY_CATEGORIES.find((item) => item.id === categoryId);
  if (!category) return null;
  const fields = CATEGORY_BASELINE_FIELDS[categoryId];
  if (!fields.length) return null;
  return {
    id: `category:${categoryId}`,
    label: category.label,
    description: category.description,
    categorySlug: categoryId,
    fields: [...fields],
    collections: [],
    source: "builtin",
  };
}

export const BUILTIN_WORLD_PROFILE_DEFINITIONS: readonly WorldProfileDefinition[] = [
  ...WORLD_KIND_KEYS.map(builtinKindDefinition),
  ...WORLD_PROFILE_CATEGORY_IDS.map((id) => builtinCategoryDefinition(id)).filter(
    (d): d is WorldProfileDefinition => d !== null,
  ),
];

const BUILTIN_BY_ID = new Map(BUILTIN_WORLD_PROFILE_DEFINITIONS.map((d) => [d.id, d]));

export function isWorldProfileFieldType(value: string): value is WorldProfileFieldType {
  return (WORLD_PROFILE_FIELD_TYPES as readonly string[]).includes(value);
}

export function parseProfileSpecJson(raw: unknown): {
  fields: WorldProfileFieldDef[];
  collections: WorldProfileCollectionDef[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { fields: [], collections: [] };
  const row = raw as Record<string, unknown>;
  const fields: WorldProfileFieldDef[] = [];
  const collections: WorldProfileCollectionDef[] = [];
  if (Array.isArray(row.fields)) {
    for (const item of row.fields) {
      if (!item || typeof item !== "object") continue;
      const field = item as Record<string, unknown>;
      const key = typeof field.key === "string" ? field.key.trim() : "";
      const label = typeof field.label === "string" ? field.label.trim() : "";
      const type = typeof field.type === "string" && isWorldProfileFieldType(field.type) ? field.type : null;
      if (!key || !label || !type) continue;
      const options = Array.isArray(field.options)
        ? field.options.flatMap((opt) => {
            if (!opt || typeof opt !== "object") return [];
            const o = opt as Record<string, unknown>;
            const id = typeof o.id === "string" ? o.id.trim() : "";
            const optLabel = typeof o.label === "string" ? o.label.trim() : id;
            return id ? [{ id, label: optLabel || id }] : [];
          })
        : undefined;
      fields.push({
        key,
        label,
        type,
        storage: field.storage === "flat" ? "flat" : "profile",
        multiline: field.multiline === true || type === "long_text",
        optional: field.optional !== false,
        description: typeof field.description === "string" ? field.description : undefined,
        placeholder: typeof field.placeholder === "string" ? field.placeholder : undefined,
        options,
      });
      if (fields.length >= 48) break;
    }
  }
  if (Array.isArray(row.collections)) {
    for (const item of row.collections) {
      if (!item || typeof item !== "object") continue;
      const col = item as Record<string, unknown>;
      const key = typeof col.key === "string" ? col.key.trim() : "";
      const label = typeof col.label === "string" ? col.label.trim() : "";
      if (!key || !label) continue;
      const nested = parseProfileSpecJson({ fields: col.fields }).fields.map((f) => ({
        ...f,
        storage: "profile" as const,
      }));
      collections.push({
        key,
        label,
        description: typeof col.description === "string" ? col.description : undefined,
        fields: nested,
      });
      if (collections.length >= 16) break;
    }
  }
  return { fields, collections };
}

function fieldsFromLegacyTemplate(fields: readonly KindTemplateField[]): WorldProfileFieldDef[] {
  return fields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.multiline ? "long_text" : "short_text",
    storage: "flat" as const,
    multiline: field.multiline,
    optional: true,
  }));
}

export function definitionFromKindTemplate(template: KindTemplateView & { profileSpecJson?: string | null }): WorldProfileDefinition {
  const parsedSpec =
    template.profileSpecJson && template.profileSpecJson.trim()
      ? (() => {
          try {
            return parseProfileSpecJson(JSON.parse(template.profileSpecJson));
          } catch {
            return { fields: [] as WorldProfileFieldDef[], collections: [] as WorldProfileCollectionDef[] };
          }
        })()
      : { fields: [] as WorldProfileFieldDef[], collections: [] as WorldProfileCollectionDef[] };
  const legacyFlat = fieldsFromLegacyTemplate(template.fields);
  const typedKeys = new Set(parsedSpec.fields.map((f) => f.key));
  const mergedFields = [...legacyFlat.filter((f) => !typedKeys.has(f.key)), ...parsedSpec.fields];
  return {
    id: template.definitionId?.trim() || `kind:${template.kind}`,
    label: template.label?.trim() || template.kind,
    description: template.description ?? "",
    categorySlug: template.categorySlug ?? undefined,
    subcategorySlug: template.subcategorySlug ?? undefined,
    fields: mergedFields,
    collections: parsedSpec.collections,
    homeProjectId: template.home?.projectId ?? null,
    homeLabel: template.home ? template.home.bookName?.trim() || template.home.title : null,
    source: "template",
    templateId: template.id,
    kind: template.kind,
  };
}

export function listBuiltinWorldProfileDefinitions(): readonly WorldProfileDefinition[] {
  return BUILTIN_WORLD_PROFILE_DEFINITIONS;
}

export function getBuiltinWorldProfileDefinition(id: string): WorldProfileDefinition | null {
  return BUILTIN_BY_ID.get(id) ?? null;
}

export function listAvailableWorldProfileDefinitions(
  templates: readonly (KindTemplateView & { profileSpecJson?: string | null; definitionId?: string | null; label?: string | null; description?: string; categorySlug?: string | null; subcategorySlug?: string | null })[],
): WorldProfileDefinition[] {
  const custom = templates.map((template) => definitionFromKindTemplate(template));
  const customIds = new Set(custom.map((d) => d.id));
  const customKinds = new Set(custom.map((d) => d.kind).filter(Boolean));
  const builtins = BUILTIN_WORLD_PROFILE_DEFINITIONS.filter(
    (d) => !customIds.has(d.id) && !(d.kindKey && customKinds.has(d.kindKey)),
  );
  return [...builtins, ...custom];
}

export type WorldProfileTemplateInput = KindTemplateView & {
  profileSpecJson?: string | null;
  definitionId?: string | null;
  label?: string | null;
  description?: string;
  categorySlug?: string | null;
  subcategorySlug?: string | null;
};

/**
 * Built-ins and templates that could fit this record. Explicit selection is not
 * required for listing; taxonomy memberships and kind all contribute. Changing
 * tags or secondary categories never removes a previously selected definitionId.
 */
export function listPlausibleWorldProfileDefinitions(input: {
  fields: Readonly<Record<string, unknown>>;
  profile?: WorldProfile | null;
  templates?: readonly WorldProfileTemplateInput[];
  recordProjectId?: string;
  categorySlugs?: readonly string[];
}): WorldProfileDefinition[] {
  const available = listAvailableWorldProfileDefinitions(input.templates ?? []);
  const byId = new Map(available.map((item) => [item.id, item]));
  const out: WorldProfileDefinition[] = [];
  const seen = new Set<string>();
  const push = (definition: WorldProfileDefinition | null | undefined) => {
    if (!definition || seen.has(definition.id)) return;
    seen.add(definition.id);
    out.push(definition);
  };

  const explicitId = input.profile?.definitionId ?? null;
  if (explicitId) {
    push(byId.get(explicitId) ?? getBuiltinWorldProfileDefinition(explicitId));
  }

  const kind = worldbuildingKindRaw(input.fields);
  if (kind && input.recordProjectId && input.templates?.length) {
    const home = input.templates.find((t) => t.projectId === input.recordProjectId && t.kind === kind);
    if (home) push(definitionFromKindTemplate(home));
    else {
      const any = input.templates.find((t) => t.kind === kind);
      if (any) push(definitionFromKindTemplate(any));
    }
  }

  const known = worldbuildingKindFromFields(input.fields);
  if (known) push(getBuiltinWorldProfileDefinition(`builtin:${known}`));

  const categories = input.categorySlugs?.length
    ? input.categorySlugs
    : [];
  for (const slug of categories) {
    if (!isWorldProfileCategoryId(slug)) continue;
    push(byId.get(`category:${slug}`) ?? getBuiltinWorldProfileDefinition(`category:${slug}`));
  }

  return out;
}

/**
 * Resolve the profile definition for a record.
 * 1. Explicit `worldProfile.definitionId` (sticky across taxonomy edits).
 * 2. Home-project custom template for the record kind.
 * 3. Single plausible built-in (kind or primary category).
 * When several built-ins are plausible and nothing is selected, return null so
 * the author can choose — never auto-switch on read or tag changes.
 */
export function resolveWorldProfileDefinition(input: {
  fields: Readonly<Record<string, unknown>>;
  profile?: WorldProfile | null;
  templates?: readonly WorldProfileTemplateInput[];
  recordProjectId?: string;
  categorySlug?: string | null;
  categorySlugs?: readonly string[];
}): WorldProfileDefinition | null {
  const available = listAvailableWorldProfileDefinitions(input.templates ?? []);
  const definitionId = input.profile?.definitionId ?? null;
  if (definitionId) {
    const found = available.find((d) => d.id === definitionId) ?? getBuiltinWorldProfileDefinition(definitionId);
    if (found) return found;
  }

  const kind = worldbuildingKindRaw(input.fields);
  if (kind && input.recordProjectId && input.templates?.length) {
    const home = input.templates.find((t) => t.projectId === input.recordProjectId && t.kind === kind);
    if (home) return definitionFromKindTemplate(home);
    const any = input.templates.find((t) => t.kind === kind);
    if (any) return definitionFromKindTemplate(any);
  }

  const categorySlugs = [
    ...(input.categorySlugs ?? []),
    ...(input.categorySlug ? [input.categorySlug] : []),
  ];
  const plausible = listPlausibleWorldProfileDefinitions({
    fields: input.fields,
    profile: null,
    templates: input.templates,
    recordProjectId: input.recordProjectId,
    categorySlugs,
  });

  // Without an explicit choice: auto-pick only when exactly one candidate remains.
  if (plausible.length === 1) return plausible[0]!;
  return null;
}

function calendarLooksValid(value: WorldProfileCalendarDate): boolean {
  if (value.freeText?.trim()) return true;
  return value.year != null || value.monthPosition != null || value.day != null || value.eraId != null;
}

export function validateProfileValuesAgainstDefinition(
  definition: WorldProfileDefinition,
  profile: WorldProfile,
  flatFields: Readonly<Record<string, unknown>>,
): WorldProfileProblem[] {
  const problems: WorldProfileProblem[] = [];
  for (const field of definition.fields) {
    const raw =
      field.storage === "flat" ? flatFields[field.key] : profile.values[field.key];
    if (raw === undefined || raw === null || raw === "") {
      if (field.optional === false) {
        problems.push({ path: field.key, message: `${field.label} is required.` });
      }
      continue;
    }
    const value = readWorldProfileFieldValue(raw);
    if (value === null && raw !== null) {
      problems.push({ path: field.key, message: `${field.label} has an unsupported value shape.` });
      continue;
    }
    switch (field.type) {
      case "short_text":
      case "long_text":
      case "select":
        if (typeof value !== "string") {
          problems.push({ path: field.key, message: `${field.label} must be text.` });
        } else if (field.type === "select" && field.options?.length && !field.options.some((o) => o.id === value)) {
          problems.push({ path: field.key, message: `${field.label} must be one of the allowed options.` });
        }
        break;
      case "number":
        if (typeof value !== "number") problems.push({ path: field.key, message: `${field.label} must be a number.` });
        break;
      case "boolean":
        if (typeof value !== "boolean") problems.push({ path: field.key, message: `${field.label} must be true or false.` });
        break;
      case "multi_select":
      case "ordered_list":
      case "record_refs":
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
          problems.push({ path: field.key, message: `${field.label} must be a list of strings.` });
        } else if (
          field.type === "multi_select" &&
          field.options?.length &&
          value.some((item) => !field.options!.some((o) => o.id === item))
        ) {
          problems.push({ path: field.key, message: `${field.label} contains an unknown option.` });
        }
        break;
      case "record_ref":
        if (!value || typeof value !== "object" || Array.isArray(value) || !("recordId" in value)) {
          problems.push({ path: field.key, message: `${field.label} must reference a record.` });
        }
        break;
      case "calendar_date":
        if (!value || typeof value !== "object" || Array.isArray(value) || "recordId" in value) {
          problems.push({ path: field.key, message: `${field.label} must be a calendar date.` });
        } else if (!calendarLooksValid(value as WorldProfileCalendarDate)) {
          problems.push({ path: field.key, message: `${field.label} needs a date or free-text date.` });
        }
        break;
      default:
        break;
    }
  }
  for (const collection of definition.collections) {
    const items = profile.collections[collection.key] ?? [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      for (const field of collection.fields) {
        const raw = item.fields[field.key];
        if (raw === undefined || raw === null || raw === "") continue;
        const value = readWorldProfileFieldValue(raw);
        if (value === null && raw !== null) {
          problems.push({
            path: `collections.${collection.key}[${i}].${field.key}`,
            message: `${collection.label}: ${field.label} has an unsupported value shape.`,
          });
        }
      }
    }
  }
  return problems;
}

export function profileFieldValueForDisplay(
  definition: WorldProfileDefinition | null,
  key: string,
  profile: WorldProfile,
  flatFields: Readonly<Record<string, unknown>>,
): WorldProfileFieldValue {
  const field = definition?.fields.find((item) => item.key === key);
  if (field?.storage === "flat") return readWorldProfileFieldValue(flatFields[key]);
  if (key in profile.values) return profile.values[key] ?? null;
  return readWorldProfileFieldValue(flatFields[key]);
}
