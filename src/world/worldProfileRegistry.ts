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
  "quantity",
  "glossed_lines",
] as const;
export type WorldProfileFieldType = (typeof WORLD_PROFILE_FIELD_TYPES)[number];

export type WorldProfileFieldStorage = "flat" | "profile";

export interface WorldProfileFieldOption {
  id: string;
  label: string;
}

export interface WorldProfileQuantityConfig {
  allowUnit?: boolean;
  unitSuggestions?: readonly string[];
  integerOnly?: boolean;
  allowQualifiers?: boolean;
}

/** Labels for a glossed_lines editor. recordLabel enables an optional Record.id on each row. */
export interface WorldProfileGlossedConfig {
  lineLabel: string;
  glossLabel: string;
  addLabel: string;
  removeLabel: string;
  moveUpLabel: string;
  moveDownLabel: string;
  recordLabel?: string;
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
  quantityConfig?: WorldProfileQuantityConfig;
  glossedConfig?: WorldProfileGlossedConfig;
  /**
   * descriptive = prose or a sample utterance. Continuity may show it, but it
   * is not an assertable contradiction rule.
   */
  continuity?: "descriptive";
}

export interface WorldSubcategorySectionDef {
  id: string;
  categoryId: string;
  subcategoryId: string;
  label: string;
  description: string;
  fields: readonly WorldProfileFieldDef[];
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

/** Shared across cities_and_settlements and regions; each record stores its own value. */
export const POPULATION_ESTIMATE_FIELD: WorldProfileFieldDef = {
  key: "populationEstimate",
  label: "Population estimate",
  description: "Qualified headcount. Leave blank for unknown; enter 0 for a documented zero.",
  type: "quantity",
  storage: "profile",
  optional: true,
  quantityConfig: {
    allowUnit: false,
    integerOnly: true,
    allowQualifiers: true,
  },
};

const AREA_UNIT_SUGGESTIONS = ["sq mi", "km²", "acres", "hectares", "leagues²"] as const;
const LENGTH_UNIT_SUGGESTIONS = ["miles", "km", "leagues"] as const;

export const WORLD_SUBCATEGORY_SECTIONS: readonly WorldSubcategorySectionDef[] = [
  {
    id: "geography:cities_and_settlements",
    categoryId: "geography",
    subcategoryId: "cities_and_settlements",
    label: "Cities and settlements",
    description: "Population and industries for towns, cities, and villages.",
    fields: [
      POPULATION_ESTIMATE_FIELD,
      profileField(
        "principalIndustries",
        "Principal industries",
        "ordered_list",
        "Main trades and industries, one per line.",
      ),
    ],
  },
  {
    id: "geography:regions",
    categoryId: "geography",
    subcategoryId: "regions",
    label: "Regions",
    description: "Population and land area for provinces, biomes, and named areas.",
    fields: [
      POPULATION_ESTIMATE_FIELD,
      {
        key: "landArea",
        label: "Land area",
        description: "Qualified area with a unit. Leave blank for unknown; enter 0 for a documented zero.",
        type: "quantity",
        storage: "profile",
        optional: true,
        quantityConfig: {
          allowUnit: true,
          unitSuggestions: AREA_UNIT_SUGGESTIONS,
          allowQualifiers: true,
        },
      },
    ],
  },
  {
    id: "geography:waterways",
    categoryId: "geography",
    subcategoryId: "waterways",
    label: "Waterways",
    description: "Length, source, outlet, and navigable stretches for rivers, seas, and coasts.",
    fields: [
      {
        key: "length",
        label: "Length",
        description: "Qualified length with a unit. Leave blank for unknown; enter 0 for a documented zero.",
        type: "quantity",
        storage: "profile",
        optional: true,
        quantityConfig: {
          allowUnit: true,
          unitSuggestions: LENGTH_UNIT_SUGGESTIONS,
          allowQualifiers: true,
        },
      },
      profileField(
        "waterwaySource",
        "Source",
        "short_text",
        "Headwaters or origin (text). Distinct from magic-system Source.",
      ),
      {
        key: "outlet",
        label: "Outlet",
        description:
          "Where the waterway flows. Prefer a Place relationship (flows into) when the outlet is a known record.",
        type: "short_text",
        storage: "profile",
        optional: true,
        placeholder: "Free text, or use Flows into for a known place",
      },
      profileField(
        "navigableStretches",
        "Navigable stretches",
        "long_text",
        "Which reaches are navigable and under what conditions.",
      ),
    ],
  },
  {
    id: "organizations:guilds",
    categoryId: "organizations",
    subcategoryId: "guilds",
    label: "Guilds",
    description: "Admission, apprenticeship, and credentials. Membership stays on the Organizations profile.",
    fields: [
      {
        ...profileField(
          "admissionRequirements",
          "Admission requirements",
          "long_text",
          "What a person must do or bring to be admitted. Distinct from Membership.",
        ),
        continuity: "descriptive",
      },
      {
        ...profileField(
          "apprenticeshipStages",
          "Apprenticeship stages",
          "ordered_list",
          "Stages in the order an apprentice proceeds. One stage per line.",
        ),
        continuity: "descriptive",
      },
      {
        ...profileField(
          "credentialsIssued",
          "Credentials issued",
          "ordered_list",
          "Credentials the guild grants. One credential per line.",
        ),
        continuity: "descriptive",
      },
    ],
  },
  {
    id: "religion:rituals",
    categoryId: "religion",
    subcategoryId: "rituals",
    label: "Rituals",
    description: "Occasion, roles, ordered steps, and variations for one rite. General rite notes stay on Rituals in the Religion profile.",
    fields: [
      {
        ...profileField(
          "ritualOccasion",
          "Ritual occasion",
          "short_text",
          "When this rite is held.",
        ),
        continuity: "descriptive",
      },
      {
        ...profileField(
          "participantRoles",
          "Participant roles",
          "ordered_list",
          "Roles people take in the rite. One role per line.",
        ),
        continuity: "descriptive",
      },
      {
        ...profileField(
          "ritualSteps",
          "Ritual steps",
          "ordered_list",
          "Steps in the order they are performed. One step per line.",
        ),
        continuity: "descriptive",
      },
      {
        ...profileField(
          "ritualVariations",
          "Ritual variations",
          "long_text",
          "Accepted differences in how the rite is performed.",
        ),
        continuity: "descriptive",
      },
    ],
  },
  {
    id: "languages:dialects",
    categoryId: "languages",
    subcategoryId: "dialects",
    label: "Dialects",
    description: "Parent language, sound changes, expressions, and glossed examples.",
    fields: [
      {
        key: "parentLanguage",
        label: "Parent language",
        description:
          "Language this dialect comes from. Stored as a Living World Profile record reference. Language records are not Place or Record relationship endpoints.",
        type: "record_ref",
        storage: "profile",
        optional: true,
        placeholder: "Record id of the parent language",
      },
      {
        ...profileField(
          "regionalSoundChanges",
          "Regional sound changes",
          "long_text",
          "Sound changes that mark this dialect.",
        ),
        continuity: "descriptive",
      },
      {
        ...profileField(
          "distinctiveExpressions",
          "Distinctive expressions",
          "ordered_list",
          "Phrases that mark the dialect. One expression per line.",
        ),
        continuity: "descriptive",
      },
      {
        ...profileField(
          "exampleLines",
          "Example lines",
          "glossed_lines",
          "Sample lines, each kept with its gloss.",
        ),
        continuity: "descriptive",
      },
    ],
  },
  {
    id: "locations:buildings",
    categoryId: "locations",
    subcategoryId: "buildings",
    label: "Buildings",
    description:
      "Entrances and exits, and where each one leads. Layout, access, uses, atmosphere, and distinctive features stay on the Locations profile. Containment stays a Part of place relationship.",
    fields: [
      {
        ...profileField(
          "entrances",
          "Entrances and exits",
          "glossed_lines",
          "Name each opening and where it leads. An alley, landing, or street can stay a description. Add a record id when the destination is an existing place.",
        ),
        continuity: "descriptive",
        glossedConfig: {
          lineLabel: "Entrance",
          glossLabel: "Leads to",
          addLabel: "Add entrance",
          removeLabel: "Remove entrance",
          moveUpLabel: "Move entrance up",
          moveDownLabel: "Move entrance down",
          recordLabel: "Place record id",
        },
      },
    ],
  },
  {
    id: "locations:rooms",
    categoryId: "locations",
    subcategoryId: "rooms",
    label: "Rooms",
    description:
      "Doorways and what a viewpoint can see. Layout, access, uses, atmosphere, and distinctive features stay on the Locations profile. Containment stays a Part of place relationship.",
    fields: [
      {
        ...profileField(
          "doorways",
          "Doorways and connections",
          "glossed_lines",
          "Name each doorway and where it connects. A landing or passage can stay a description. Add a record id when it opens onto an existing place.",
        ),
        continuity: "descriptive",
        glossedConfig: {
          lineLabel: "Doorway",
          glossLabel: "Connects to",
          addLabel: "Add doorway",
          removeLabel: "Remove doorway",
          moveUpLabel: "Move doorway up",
          moveDownLabel: "Move doorway down",
          recordLabel: "Place record id",
        },
      },
      {
        ...profileField(
          "sightlines",
          "Sightlines",
          "glossed_lines",
          "A viewpoint and what is visible from it.",
        ),
        continuity: "descriptive",
        glossedConfig: {
          lineLabel: "Viewpoint",
          glossLabel: "Visible",
          addLabel: "Add sightline",
          removeLabel: "Remove sightline",
          moveUpLabel: "Move sightline up",
          moveDownLabel: "Move sightline down",
        },
      },
    ],
  },
];

const SUBCATEGORY_SECTION_BY_ID = new Map(WORLD_SUBCATEGORY_SECTIONS.map((section) => [section.id, section]));

const DESCRIPTIVE_SUBCATEGORY_FIELD_KEYS = new Set(
  WORLD_SUBCATEGORY_SECTIONS.flatMap((section) =>
    section.fields.filter((field) => field.continuity === "descriptive").map((field) => field.key),
  ),
);

/** Prose and sample utterances. Structuring them does not make them contradiction rules. */
export function isDescriptiveSubcategoryField(fieldKey: string): boolean {
  return DESCRIPTIVE_SUBCATEGORY_FIELD_KEYS.has(fieldKey);
}

export function getSubcategorySection(id: string): WorldSubcategorySectionDef | null {
  return SUBCATEGORY_SECTION_BY_ID.get(id) ?? null;
}

export function listAllSubcategorySections(): readonly WorldSubcategorySectionDef[] {
  return WORLD_SUBCATEGORY_SECTIONS;
}

/** Sections suggested by primary/secondary taxonomy placements (read-only suggestions). */
export function listSubcategorySectionsForTaxonomy(input: {
  primary?: { category: string; subcategory?: string | null } | null;
  secondary?: readonly { category: string; subcategory?: string | null }[];
}): WorldSubcategorySectionDef[] {
  const keys = new Set<string>();
  const placements = [
    ...(input.primary ? [input.primary] : []),
    ...(input.secondary ?? []),
  ];
  for (const placement of placements) {
    if (!placement.subcategory) continue;
    keys.add(`${placement.category}:${placement.subcategory}`);
  }
  return WORLD_SUBCATEGORY_SECTIONS.filter((section) => keys.has(section.id));
}

function sectionHasStoredValues(section: WorldSubcategorySectionDef, profile: WorldProfile): boolean {
  for (const field of section.fields) {
    const value = profile.values[field.key];
    if (value !== undefined && value !== null && value !== "") return true;
    const historyHit = profile.fieldHistory.some(
      (change) =>
        change.fieldPath === `values.${field.key}` ||
        change.fieldPath === field.key ||
        change.fieldPath.endsWith(`.${field.key}`),
    );
    if (historyHit) return true;
  }
  return false;
}

/**
 * Sections that stay discoverable: enabled on the profile, or carrying saved
 * values / fieldHistory even after taxonomy no longer matches.
 */
export function listSubcategorySectionsWithStoredValues(profile: WorldProfile): WorldSubcategorySectionDef[] {
  const enabled = new Set(profile.enabledSections);
  const out: WorldSubcategorySectionDef[] = [];
  const seen = new Set<string>();
  for (const section of WORLD_SUBCATEGORY_SECTIONS) {
    if (seen.has(section.id)) continue;
    if (enabled.has(section.id) || sectionHasStoredValues(section, profile)) {
      seen.add(section.id);
      out.push(section);
    }
  }
  return out;
}

function validateFieldValue(
  field: WorldProfileFieldDef,
  raw: unknown,
  path: string,
  problems: WorldProfileProblem[],
): void {
  if (raw === undefined || raw === null || raw === "") {
    if (field.optional === false) {
      problems.push({ path, message: `${field.label} is required.` });
    }
    return;
  }
  const value = readWorldProfileFieldValue(raw);
  if (value === null && raw !== null) {
    problems.push({ path, message: `${field.label} has an unsupported value shape.` });
    return;
  }
  switch (field.type) {
    case "short_text":
    case "long_text":
    case "select":
      // Outlet may store a Place record ref from flows_into reuse, or free text.
      if (
        field.key === "outlet" &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "recordId" in value
      ) {
        break;
      }
      if (typeof value !== "string") {
        problems.push({ path, message: `${field.label} must be text.` });
      } else if (field.type === "select" && field.options?.length && !field.options.some((o) => o.id === value)) {
        problems.push({ path, message: `${field.label} must be one of the allowed options.` });
      }
      break;
    case "number":
      if (typeof value !== "number") problems.push({ path, message: `${field.label} must be a number.` });
      break;
    case "boolean":
      if (typeof value !== "boolean") problems.push({ path, message: `${field.label} must be true or false.` });
      break;
    case "glossed_lines":
      if (typeof value === "string") break;
      if (Array.isArray(value) && value.length === 0) break;
      if (
        !Array.isArray(value) ||
        value.some(
          (item) =>
            !item ||
            typeof item !== "object" ||
            Array.isArray(item) ||
            typeof (item as { line?: unknown }).line !== "string" ||
            typeof (item as { gloss?: unknown }).gloss !== "string",
        )
      ) {
        problems.push({ path, message: `${field.label} must be example lines paired with glosses.` });
      }
      break;
    case "multi_select":
    case "ordered_list":
    case "record_refs":
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        problems.push({ path, message: `${field.label} must be a list of strings.` });
      } else if (
        field.type === "multi_select" &&
        field.options?.length &&
        value.some((item) => !field.options!.some((o) => o.id === item))
      ) {
        problems.push({ path, message: `${field.label} contains an unknown option.` });
      }
      break;
    case "record_ref":
      if (typeof value === "string") break;
      if (!value || typeof value !== "object" || Array.isArray(value) || !("recordId" in value)) {
        problems.push({ path, message: `${field.label} must reference a record.` });
      }
      break;
    case "calendar_date":
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        "recordId" in value ||
        "amount" in value
      ) {
        problems.push({ path, message: `${field.label} must be a calendar date.` });
      } else if (!calendarLooksValid(value as WorldProfileCalendarDate)) {
        problems.push({ path, message: `${field.label} needs a date or free-text date.` });
      }
      break;
    case "quantity":
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !("amount" in value) ||
        typeof (value as { amount: unknown }).amount !== "number" ||
        !Number.isFinite((value as { amount: number }).amount)
      ) {
        problems.push({ path, message: `${field.label} must be a quantity with a finite amount.` });
      } else if (
        field.quantityConfig?.integerOnly &&
        !Number.isInteger((value as { amount: number }).amount)
      ) {
        problems.push({ path, message: `${field.label} must be a whole number.` });
      }
      break;
    default:
      break;
  }
}

export function validateProfileValuesAgainstDefinition(
  definition: WorldProfileDefinition,
  profile: WorldProfile,
  flatFields: Readonly<Record<string, unknown>>,
): WorldProfileProblem[] {
  const problems: WorldProfileProblem[] = [];
  for (const field of definition.fields) {
    const raw = field.storage === "flat" ? flatFields[field.key] : profile.values[field.key];
    validateFieldValue(field, raw, field.key, problems);
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

export function validateSubcategorySectionValues(
  profile: WorldProfile,
  sectionIds: readonly string[] = profile.enabledSections,
): WorldProfileProblem[] {
  const problems: WorldProfileProblem[] = [];
  for (const id of sectionIds) {
    const section = getSubcategorySection(id);
    if (!section) continue;
    for (const field of section.fields) {
      validateFieldValue(field, profile.values[field.key], `values.${field.key}`, problems);
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
