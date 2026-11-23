import {
  normalizeImportance,
  readCharacterDevelopment,
  type ImportanceLevel,
  type NarrativeRole,
} from "@/domain/characterDevelopment";
import type { JsonObject, JsonValue } from "@/domain/json";
import { isRecordType, type RecordType } from "@/domain/recordTypes";
import { RECORD_GROUPS } from "@/ui/navigation";
import { isWorldKindKey, type WorldKindKey } from "./referenceTemplates";
import { worldbuildingCustomKind, worldbuildingKindRaw } from "./worldKinds";

function isWorldRecordType(type: RecordType): boolean {
  return (RECORD_GROUPS.world as readonly string[]).includes(type);
}

/**
 * World Hub taxonomy: thematic discovery for World references.
 *
 * Coexistence with `fields.kind`:
 * - `fields.kind` governs structured field specs (`WORLD_KIND_FIELD_SPECS`),
 *   `WorldKindTemplate`, name patterns, and relation endpoints for place /
 *   organization. It is never rewritten by taxonomy resolution.
 * - `fields.taxonomy` governs thematic World Hub discovery (primary /
 *   secondary categories, subcategories, tags). When `primary` is set it
 *   takes precedence for thematic categorization; when unset, resolution
 *   falls back to `Record.type` and `fields.kind` at read time only.
 *
 * Taxonomy never redefines document type, identity, relationships, or
 * authority status. Categories are authoring defaults, not requirements.
 */

export const TAXONOMY_FIELD_KEY = "taxonomy";
export const TAXONOMY_VERSION = 1 as const;

export const TAXONOMY_KNOWN_KEYS = ["version", "primary", "secondary", "tags"] as const;

const MAX_ID_LEN = 80;
const MAX_TAG_LEN = 80;
const MAX_TAGS = 32;
const MAX_SECONDARY = 24;

export type TaxonomyIconKey =
  | "user"
  | "globe"
  | "mapPin"
  | "sparkles"
  | "users"
  | "landmark"
  | "church"
  | "building"
  | "languages"
  | "scroll"
  | "coins"
  | "cog"
  | "gem"
  | "scale";

export interface TaxonomySubcategoryDef {
  id: string;
  label: string;
  description: string;
}

export interface TaxonomyCategoryDef {
  id: string;
  label: string;
  description: string;
  icon: TaxonomyIconKey;
  subcategories: readonly TaxonomySubcategoryDef[];
}

function sub(id: string, label: string, description: string): TaxonomySubcategoryDef {
  return { id, label, description };
}

export const WORLD_TAXONOMY_CATEGORIES: readonly TaxonomyCategoryDef[] = [
  {
    id: "characters",
    label: "Characters",
    description: "People who appear in the story.",
    icon: "user",
    subcategories: [
      sub("protagonists", "Protagonists", "Central viewpoint or driving characters."),
      sub("supporting_characters", "Supporting characters", "Recurring allies and secondary leads."),
      sub("antagonists", "Antagonists", "Opposing forces and rivals."),
      sub("minor_characters", "Minor characters", "Brief or background appearances."),
    ],
  },
  {
    id: "geography",
    label: "Geography",
    description: "Worlds, landforms, and natural regions.",
    icon: "globe",
    subcategories: [
      sub("worlds", "Worlds", "Planets, planes, or named worlds."),
      sub("continents", "Continents", "Large landmasses."),
      sub("nations", "Nations", "Countries and sovereign territories."),
      sub("regions", "Regions", "Provinces, biomes, and named areas."),
      sub("cities_and_settlements", "Cities and settlements", "Towns, cities, and villages."),
      sub("districts", "Districts", "Neighborhoods and quarters."),
      sub("landforms", "Landforms", "Mountains, deserts, islands, and similar."),
      sub("waterways", "Waterways", "Rivers, seas, lakes, and coasts."),
      sub("ecosystems", "Ecosystems", "Habitats and ecological zones."),
    ],
  },
  {
    id: "locations",
    label: "Locations",
    description: "Built or named places characters visit.",
    icon: "mapPin",
    subcategories: [
      sub("buildings", "Buildings", "Houses, keeps, shops, and halls."),
      sub("landmarks", "Landmarks", "Monuments and notable sites."),
      sub("rooms", "Rooms", "Interior spaces."),
      sub("venues", "Venues", "Public gathering places."),
      sub("sacred_sites", "Sacred sites", "Temples, shrines, and holy ground."),
      sub("infrastructure_sites", "Infrastructure sites", "Ports, roads, bridges, and works."),
    ],
  },
  {
    id: "magic",
    label: "Magic",
    description: "Magic systems, abilities, and workings.",
    icon: "sparkles",
    subcategories: [
      sub("systems", "Systems", "Overall magic frameworks."),
      sub("abilities", "Abilities", "Powers and gifts."),
      sub("workings", "Workings", "Spells, rituals, and techniques."),
      sub("rules", "Rules", "Constraints and costs."),
      sub("magical_artifacts", "Magical artifacts", "Enchanted objects."),
    ],
  },
  {
    id: "peoples",
    label: "Peoples",
    description: "Species, ancestry, and physiology.",
    icon: "users",
    subcategories: [
      sub("species", "Species", "Species and races."),
      sub("ancestry", "Ancestry", "Heritage and bloodlines."),
      sub("lineages", "Lineages", "Named family or clan lines."),
      sub("physiology", "Physiology", "Bodies, senses, and biology."),
    ],
  },
  {
    id: "cultures",
    label: "Cultures",
    description: "Customs, arts, and social life.",
    icon: "landmark",
    subcategories: [
      sub("customs", "Customs", "Everyday practices."),
      sub("traditions", "Traditions", "Seasonal and ceremonial practices."),
      sub("social_structures", "Social structures", "Classes, castes, and roles."),
      sub("clothing", "Clothing", "Dress and adornment."),
      sub("cuisine", "Cuisine", "Food and drink."),
      sub("arts", "Arts", "Music, visual arts, and performance."),
    ],
  },
  {
    id: "religion",
    label: "Religion",
    description: "Faiths, deities, and belief.",
    icon: "church",
    subcategories: [
      sub("faiths", "Faiths", "Religions and pantheons."),
      sub("denominations", "Denominations", "Sects and orders within a faith."),
      sub("deities", "Deities", "Gods, spirits, and worshipped figures."),
      sub("rituals", "Rituals", "Rites and observances."),
      sub("sacred_places", "Sacred places", "Holy locations."),
      sub("beliefs", "Beliefs", "Doctrine and cosmology."),
    ],
  },
  {
    id: "organizations",
    label: "Organizations",
    description: "Governments, guilds, and groups.",
    icon: "building",
    subcategories: [
      sub("government", "Government", "States and ruling bodies."),
      sub("guilds", "Guilds", "Trade and craft guilds."),
      sub("military", "Military", "Armies and martial orders."),
      sub("criminal_groups", "Criminal groups", "Gangs and underworld networks."),
      sub("institutions", "Institutions", "Schools, courts, and formal bodies."),
      sub("associations", "Associations", "Clubs, cabals, and loose groups."),
    ],
  },
  {
    id: "languages",
    label: "Languages",
    description: "Speech, writing, and naming.",
    icon: "languages",
    subcategories: [
      sub("languages", "Languages", "Full languages."),
      sub("dialects", "Dialects", "Regional or social variants."),
      sub("vocabulary", "Vocabulary", "Word lists and glossaries."),
      sub("grammar", "Grammar", "Structure and usage notes."),
      sub("naming_conventions", "Naming conventions", "Personal and place naming."),
    ],
  },
  {
    id: "history",
    label: "History",
    description: "Eras, events, and historical figures.",
    icon: "scroll",
    subcategories: [
      sub("eras", "Eras", "Ages and periods."),
      sub("historical_events", "Historical events", "Notable past events."),
      sub("conflicts", "Conflicts", "Wars and struggles."),
      sub("treaties", "Treaties", "Pacts and agreements."),
      sub("historical_figures", "Historical figures", "People of the past."),
    ],
  },
  {
    id: "economy",
    label: "Economy",
    description: "Trade, currency, and livelihoods.",
    icon: "coins",
    subcategories: [
      sub("currency", "Currency", "Money and exchange."),
      sub("trade", "Trade", "Routes and markets."),
      sub("banking", "Banking", "Credit and finance."),
      sub("resources", "Resources", "Materials and commodities."),
      sub("professions", "Professions", "Jobs and crafts of work."),
    ],
  },
  {
    id: "technology",
    label: "Technology",
    description: "Tools, engineering, and crafts.",
    icon: "cog",
    subcategories: [
      sub("transportation", "Transportation", "Travel and vehicles."),
      sub("communications", "Communications", "Messages and signals."),
      sub("infrastructure", "Infrastructure", "Built systems and networks."),
      sub("engineering", "Engineering", "Machines and construction."),
      sub("crafts", "Crafts", "Making and skilled trades."),
    ],
  },
  {
    id: "objects",
    label: "Objects",
    description: "Artifacts, documents, and gear.",
    icon: "gem",
    subcategories: [
      sub("artifacts", "Artifacts", "Notable or unique items."),
      sub("possessions", "Possessions", "Personal belongings."),
      sub("documents", "Documents", "Letters, books, and records."),
      sub("equipment", "Equipment", "Tools and gear."),
    ],
  },
  {
    id: "law",
    label: "Law",
    description: "Legislation, rights, and enforcement.",
    icon: "scale",
    subcategories: [
      sub("legislation", "Legislation", "Laws and codes."),
      sub("institutions", "Institutions", "Courts and legal bodies."),
      sub("rights", "Rights", "Liberties and privileges."),
      sub("jurisdiction", "Jurisdiction", "Authority and territory of law."),
      sub("enforcement", "Enforcement", "Police, guards, and penalties."),
    ],
  },
] as const;

export type TaxonomyCategoryId = (typeof WORLD_TAXONOMY_CATEGORIES)[number]["id"];

const CATEGORY_BY_ID = new Map(WORLD_TAXONOMY_CATEGORIES.map((c) => [c.id, c]));

/** Built-in `fields.kind` → taxonomy category (read-time only). */
export const LEGACY_KIND_TO_CATEGORY: Record<WorldKindKey, TaxonomyCategoryId> = {
  place: "locations",
  species: "peoples",
  magic_system: "magic",
  culture: "cultures",
  religion: "religion",
  organization: "organizations",
  language: "languages",
  object: "objects",
};

export interface TaxonomyPlacement {
  category: string;
  subcategory?: string;
}

export interface RecordTaxonomyV1 {
  version: 1;
  primary?: TaxonomyPlacement | null;
  secondary?: TaxonomyPlacement[];
  tags?: string[];
}

export interface TaxonomyProblem {
  path: string;
  message: string;
}

export interface ResolvedTaxonomy {
  /** Explicit `fields.taxonomy` when present and valid; otherwise null. */
  stored: RecordTaxonomyV1 | null;
  /** Effective primary used for discovery (stored or legacy/default). */
  primary: TaxonomyPlacement | null;
  /** Secondary memberships from stored taxonomy only. */
  secondary: TaxonomyPlacement[];
  tags: string[];
  /** All category IDs / custom category slugs this record belongs to (primary + secondary). */
  memberships: TaxonomyPlacement[];
  /** Author custom `fields.kind` when not a built-in key. */
  customKind: string | null;
  /** True when no stored primary and no legacy/default category applies. */
  isUnclassified: boolean;
  /** True when primary came from type / kind / characterDevelopment, not stored taxonomy. */
  usedLegacyFallback: boolean;
}

export function isTaxonomyCategoryId(value: string): value is TaxonomyCategoryId {
  return CATEGORY_BY_ID.has(value);
}

export function getTaxonomyCategory(id: string): TaxonomyCategoryDef | null {
  return CATEGORY_BY_ID.get(id) ?? null;
}

export function getTaxonomySubcategory(categoryId: string, subId: string): TaxonomySubcategoryDef | null {
  const category = getTaxonomyCategory(categoryId);
  if (!category) return null;
  return category.subcategories.find((item) => item.id === subId) ?? null;
}

/** Normalize a custom category/subcategory/tag slug for storage and comparison. */
export function normalizeCustomTaxonomySlug(raw: unknown, maxLen = MAX_ID_LEN): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.normalize("NFC").trim().slice(0, maxLen);
  return trimmed || null;
}

function placementKey(placement: TaxonomyPlacement): string {
  return `${placement.category}\0${placement.subcategory ?? ""}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parsePlacement(value: unknown, path: string, problems: TaxonomyProblem[]): TaxonomyPlacement | null {
  if (value === null || value === undefined) return null;
  const row = asRecord(value);
  if (!row) {
    problems.push({ path, message: "Taxonomy placement must be an object." });
    return null;
  }
  const category = normalizeCustomTaxonomySlug(row.category);
  if (!category) {
    problems.push({ path: `${path}.category`, message: "Taxonomy placement needs a category." });
    return null;
  }
  const subcategory =
    row.subcategory === undefined || row.subcategory === null
      ? undefined
      : normalizeCustomTaxonomySlug(row.subcategory);
  if (row.subcategory !== undefined && row.subcategory !== null && !subcategory) {
    problems.push({ path: `${path}.subcategory`, message: "Taxonomy subcategory must be a non-empty string when set." });
    return null;
  }
  if (subcategory && !category) {
    problems.push({ path: `${path}.category`, message: "A subcategory requires a category." });
    return null;
  }
  if (isTaxonomyCategoryId(category) && subcategory) {
    const known = getTaxonomySubcategory(category, subcategory);
    // Custom subcategories under built-in categories are allowed; built-in IDs are preferred.
    void known;
  }
  return subcategory ? { category, subcategory } : { category };
}

/**
 * Defensive read of `fields.taxonomy`. Missing taxonomy is fine.
 * Invalid shapes produce problems and an empty stored taxonomy.
 */
export function readRecordTaxonomy(fields: Readonly<Record<string, unknown>>): {
  ok: boolean;
  taxonomy: RecordTaxonomyV1 | null;
  problems: TaxonomyProblem[];
} {
  const problems: TaxonomyProblem[] = [];
  if (!(TAXONOMY_FIELD_KEY in fields) || fields[TAXONOMY_FIELD_KEY] === undefined || fields[TAXONOMY_FIELD_KEY] === null) {
    return { ok: true, taxonomy: null, problems };
  }
  const row = asRecord(fields[TAXONOMY_FIELD_KEY]);
  if (!row) {
    problems.push({ path: TAXONOMY_FIELD_KEY, message: "Taxonomy metadata is not an object." });
    return { ok: false, taxonomy: null, problems };
  }
  if (row.version !== undefined && row.version !== TAXONOMY_VERSION) {
    problems.push({ path: `${TAXONOMY_FIELD_KEY}.version`, message: "This taxonomy version is not supported." });
    return { ok: false, taxonomy: null, problems };
  }
  const primary =
    row.primary === undefined
      ? undefined
      : row.primary === null
        ? null
        : parsePlacement(row.primary, `${TAXONOMY_FIELD_KEY}.primary`, problems);
  const secondary: TaxonomyPlacement[] = [];
  if (row.secondary !== undefined && row.secondary !== null) {
    if (!Array.isArray(row.secondary)) {
      problems.push({ path: `${TAXONOMY_FIELD_KEY}.secondary`, message: "Taxonomy secondary memberships must be an array." });
    } else {
      row.secondary.forEach((item, index) => {
        const placement = parsePlacement(item, `${TAXONOMY_FIELD_KEY}.secondary[${index}]`, problems);
        if (placement) secondary.push(placement);
      });
    }
  }
  const tags: string[] = [];
  if (row.tags !== undefined && row.tags !== null) {
    if (!Array.isArray(row.tags)) {
      problems.push({ path: `${TAXONOMY_FIELD_KEY}.tags`, message: "Taxonomy tags must be an array of strings." });
    } else {
      for (let i = 0; i < row.tags.length; i++) {
        const tag = normalizeCustomTaxonomySlug(row.tags[i], MAX_TAG_LEN);
        if (!tag) {
          problems.push({ path: `${TAXONOMY_FIELD_KEY}.tags[${i}]`, message: "Each taxonomy tag must be a non-empty string." });
          continue;
        }
        tags.push(tag);
      }
    }
  }
  const taxonomy: RecordTaxonomyV1 = { version: 1 };
  if (primary !== undefined) taxonomy.primary = primary;
  if (secondary.length) taxonomy.secondary = secondary;
  if (tags.length) taxonomy.tags = tags;
  return { ok: problems.length === 0, taxonomy, problems };
}

/** Replace only `fields.taxonomy`, keeping unknown keys on both fields and taxonomy. */
export function withRecordTaxonomy(fields: JsonObject, taxonomy: RecordTaxonomyV1): JsonObject {
  const known: JsonObject = { version: TAXONOMY_VERSION };
  if (taxonomy.primary !== undefined) {
    known.primary =
      taxonomy.primary === null
        ? null
        : taxonomy.primary.subcategory
          ? { category: taxonomy.primary.category, subcategory: taxonomy.primary.subcategory }
          : { category: taxonomy.primary.category };
  }
  if (taxonomy.secondary?.length) {
    const secondary: JsonValue[] = taxonomy.secondary.map((item) => {
      const row: JsonObject = { category: item.category };
      if (item.subcategory) row.subcategory = item.subcategory;
      return row;
    });
    known.secondary = secondary;
  }
  if (taxonomy.tags?.length) known.tags = [...taxonomy.tags];
  const previous = asRecord(fields[TAXONOMY_FIELD_KEY]);
  const merged: JsonObject = { ...known };
  const knownSet = new Set<string>(TAXONOMY_KNOWN_KEYS);
  if (previous) {
    for (const key of Object.keys(previous)) {
      if (!knownSet.has(key) && !(key in known)) merged[key] = previous[key] as JsonValue;
    }
  }
  return { ...fields, [TAXONOMY_FIELD_KEY]: merged };
}

export function withoutRecordTaxonomy(fields: JsonObject): JsonObject {
  if (!(TAXONOMY_FIELD_KEY in fields)) return fields;
  const next = { ...fields };
  delete next[TAXONOMY_FIELD_KEY];
  return next;
}

/**
 * Strict write-time validation for change packages and saves.
 * Returns problems that block the write.
 */
export function taxonomyWriteProblems(value: unknown): TaxonomyProblem[] {
  if (value === undefined || value === null) return [];
  const row = asRecord(value);
  if (!row) return [{ path: TAXONOMY_FIELD_KEY, message: "Taxonomy metadata is not an object." }];
  if (row.version !== undefined && row.version !== TAXONOMY_VERSION) {
    return [{ path: `${TAXONOMY_FIELD_KEY}.version`, message: "This taxonomy version is not supported." }];
  }
  if (row.version === undefined) {
    return [{ path: `${TAXONOMY_FIELD_KEY}.version`, message: "Taxonomy metadata needs version 1." }];
  }
  const problems: TaxonomyProblem[] = [];
  let primary: TaxonomyPlacement | null | undefined;
  if (row.primary === undefined) {
    primary = undefined;
  } else if (row.primary === null) {
    primary = null;
  } else {
    primary = parsePlacement(row.primary, `${TAXONOMY_FIELD_KEY}.primary`, problems);
  }

  const secondary: TaxonomyPlacement[] = [];
  if (row.secondary !== undefined && row.secondary !== null) {
    if (!Array.isArray(row.secondary)) {
      problems.push({ path: `${TAXONOMY_FIELD_KEY}.secondary`, message: "Taxonomy secondary memberships must be an array." });
    } else if (row.secondary.length > MAX_SECONDARY) {
      problems.push({
        path: `${TAXONOMY_FIELD_KEY}.secondary`,
        message: `Taxonomy secondary memberships are limited to ${MAX_SECONDARY}.`,
      });
    } else {
      const seen = new Set<string>();
      row.secondary.forEach((item, index) => {
        const placement = parsePlacement(item, `${TAXONOMY_FIELD_KEY}.secondary[${index}]`, problems);
        if (!placement) return;
        const key = placementKey(placement);
        if (seen.has(key)) {
          problems.push({
            path: `${TAXONOMY_FIELD_KEY}.secondary[${index}]`,
            message: "Duplicate secondary taxonomy membership.",
          });
          return;
        }
        seen.add(key);
        secondary.push(placement);
      });
    }
  }

  if (primary) {
    const primaryKey = placementKey(primary);
    secondary.forEach((item, index) => {
      if (placementKey(item) === primaryKey) {
        problems.push({
          path: `${TAXONOMY_FIELD_KEY}.secondary[${index}]`,
          message: "Secondary membership must not duplicate the primary classification.",
        });
      }
    });
  }

  if (row.tags !== undefined && row.tags !== null) {
    if (!Array.isArray(row.tags)) {
      problems.push({ path: `${TAXONOMY_FIELD_KEY}.tags`, message: "Taxonomy tags must be an array of strings." });
    } else if (row.tags.length > MAX_TAGS) {
      problems.push({ path: `${TAXONOMY_FIELD_KEY}.tags`, message: `Taxonomy tags are limited to ${MAX_TAGS}.` });
    } else {
      const seenTags = new Set<string>();
      row.tags.forEach((item, index) => {
        const tag = normalizeCustomTaxonomySlug(item, MAX_TAG_LEN);
        if (!tag) {
          problems.push({ path: `${TAXONOMY_FIELD_KEY}.tags[${index}]`, message: "Each taxonomy tag must be a non-empty string." });
          return;
        }
        const fold = tag.toLocaleLowerCase();
        if (seenTags.has(fold)) {
          problems.push({ path: `${TAXONOMY_FIELD_KEY}.tags[${index}]`, message: "Duplicate taxonomy tag." });
          return;
        }
        seenTags.add(fold);
      });
    }
  }

  for (const key of Object.keys(row)) {
    if (!(TAXONOMY_KNOWN_KEYS as readonly string[]).includes(key)) {
      // Unknown keys are preserved; they are not write errors.
    }
  }

  return problems;
}

/** True when taxonomy metadata is present and the record type is not a World type. */
export function taxonomyOnNonWorldTypeProblems(type: RecordType, fields: Readonly<Record<string, unknown>>): TaxonomyProblem[] {
  if (!(TAXONOMY_FIELD_KEY in fields) || fields[TAXONOMY_FIELD_KEY] === undefined || fields[TAXONOMY_FIELD_KEY] === null) {
    return [];
  }
  if (isWorldRecordType(type)) return [];
  return [
    {
      path: TAXONOMY_FIELD_KEY,
      message: "Taxonomy classification is only allowed on World reference records.",
    },
  ];
}

function characterSubcategoryFromProfile(fields: Readonly<Record<string, unknown>>): string | undefined {
  const { profile } = readCharacterDevelopment(fields);
  const role = profile.narrativeRole as NarrativeRole | null;
  const importance = profile.importance as ImportanceLevel | null;
  if (role === "antagonist") return "antagonists";
  if (role === "protagonist" || role === "secondary_protagonist" || importance === "protagonist") return "protagonists";
  if (
    role === "supporting" ||
    role === "mentor" ||
    role === "recurring" ||
    importance === "supporting" ||
    importance === "major"
  ) {
    return "supporting_characters";
  }
  if (role === "minor" || importance === "minor" || importance === "background") return "minor_characters";
  // Normalize any legacy importance aliases already handled by normalizeImportance.
  if (normalizeImportance(importance) === "supporting") return "supporting_characters";
  return undefined;
}

function legacyPrimaryFor(type: RecordType, fields: Readonly<Record<string, unknown>>): {
  primary: TaxonomyPlacement | null;
  customKind: string | null;
} {
  if (type === "character_dossier") {
    const subcategory = characterSubcategoryFromProfile(fields);
    return {
      primary: subcategory ? { category: "characters", subcategory } : { category: "characters" },
      customKind: null,
    };
  }
  if (type === "worldbuilding") {
    const raw = worldbuildingKindRaw(fields);
    if (raw && isWorldKindKey(raw)) {
      return { primary: { category: LEGACY_KIND_TO_CATEGORY[raw] }, customKind: null };
    }
    const custom = worldbuildingCustomKind(fields);
    if (custom) {
      const slug = normalizeCustomTaxonomySlug(custom) ?? custom;
      return { primary: { category: slug }, customKind: custom };
    }
    return { primary: null, customKind: null };
  }
  return { primary: null, customKind: null };
}

/**
 * Resolve discovery classification for a World record.
 * Never infers from title or body. Never mutates stored fields.
 */
export function resolveRecordTaxonomy(input: {
  type: string;
  fields: Readonly<Record<string, unknown>>;
}): ResolvedTaxonomy {
  const type = isRecordType(input.type) ? input.type : null;
  const customKind = type === "worldbuilding" ? worldbuildingCustomKind(input.fields) : null;
  const empty: ResolvedTaxonomy = {
    stored: null,
    primary: null,
    secondary: [],
    tags: [],
    memberships: [],
    customKind,
    isUnclassified: true,
    usedLegacyFallback: false,
  };
  if (!type || !isWorldRecordType(type)) return empty;

  const { taxonomy: stored, ok } = readRecordTaxonomy(input.fields);
  const storedPrimary = ok && stored?.primary ? stored.primary : ok && stored && stored.primary === null ? null : undefined;
  const secondary = ok && stored?.secondary ? [...stored.secondary] : [];
  const tags = ok && stored?.tags ? [...stored.tags] : [];

  if (storedPrimary) {
    const memberships = [storedPrimary, ...secondary.filter((item) => placementKey(item) !== placementKey(storedPrimary))];
    return {
      stored: stored,
      primary: storedPrimary,
      secondary,
      tags,
      memberships,
      customKind,
      isUnclassified: false,
      usedLegacyFallback: false,
    };
  }

  if (stored && storedPrimary === null) {
    // Author explicitly cleared primary; still keep secondary/tags if any.
    const memberships = [...secondary];
    return {
      stored,
      primary: null,
      secondary,
      tags,
      memberships,
      customKind,
      isUnclassified: memberships.length === 0,
      usedLegacyFallback: false,
    };
  }

  const legacy = legacyPrimaryFor(type, input.fields);
  if (legacy.primary) {
    return {
      stored: stored,
      primary: legacy.primary,
      secondary,
      tags,
      memberships: [legacy.primary, ...secondary.filter((item) => placementKey(item) !== placementKey(legacy.primary!))],
      customKind: legacy.customKind ?? customKind,
      isUnclassified: false,
      usedLegacyFallback: true,
    };
  }

  return {
    stored: stored,
    primary: null,
    secondary,
    tags,
    memberships: [...secondary],
    customKind,
    isUnclassified: secondary.length === 0,
    usedLegacyFallback: false,
  };
}

/** Compact nav/discovery summary derived at read time. */
export interface TaxonomyNavSummary {
  primaryCategory: string | null;
  primarySubcategory: string | null;
  secondaryCategories: string[];
  tags: string[];
  customKind: string | null;
  isUnclassified: boolean;
  membershipKeys: string[];
}

export function taxonomyNavSummary(resolved: ResolvedTaxonomy): TaxonomyNavSummary {
  return {
    primaryCategory: resolved.primary?.category ?? null,
    primarySubcategory: resolved.primary?.subcategory ?? null,
    secondaryCategories: resolved.secondary.map((item) => item.category),
    tags: [...resolved.tags],
    customKind: resolved.customKind,
    isUnclassified: resolved.isUnclassified,
    membershipKeys: resolved.memberships.map(placementKey),
  };
}

export function recordBelongsToCategory(resolved: ResolvedTaxonomy, categoryId: string): boolean {
  return resolved.memberships.some((item) => item.category === categoryId);
}

export function recordBelongsToSubcategory(
  resolved: ResolvedTaxonomy,
  categoryId: string,
  subcategoryId: string,
): boolean {
  return resolved.memberships.some(
    (item) => item.category === categoryId && item.subcategory === subcategoryId,
  );
}

/** Snapshot helper: only `fields.taxonomy` differs; title/body/status unchanged. */
export function isTaxonomyOnlyFieldsChange(
  beforeFields: Readonly<Record<string, unknown>>,
  afterFields: Readonly<Record<string, unknown>>,
): boolean {
  const beforeKeys = Object.keys(beforeFields);
  const afterKeys = Object.keys(afterFields);
  const allKeys = new Set([...beforeKeys, ...afterKeys]);
  for (const key of allKeys) {
    if (key === TAXONOMY_FIELD_KEY) continue;
    if (JSON.stringify(beforeFields[key]) !== JSON.stringify(afterFields[key])) return false;
  }
  return JSON.stringify(beforeFields[TAXONOMY_FIELD_KEY]) !== JSON.stringify(afterFields[TAXONOMY_FIELD_KEY]);
}
