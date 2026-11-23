/** Optional author-chosen scale for a world map. Never inferred from titles. */
export const MAP_CLASSIFICATIONS = [
  "world",
  "region",
  "city",
  "district",
  "site",
  "building",
  "interior",
  "other",
] as const;

export type MapClassification = (typeof MAP_CLASSIFICATIONS)[number];

export function isMapClassification(value: string): value is MapClassification {
  return (MAP_CLASSIFICATIONS as readonly string[]).includes(value);
}

/** Normalize stored / form values; empty or unknown → null (unset). */
export function parseMapClassification(value: string | null | undefined): MapClassification | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return isMapClassification(trimmed) ? trimmed : null;
}

/** Display labels (kept here so UI and tests share one map). */
export const MAP_CLASSIFICATION_LABEL: Record<MapClassification, string> = {
  world: "World map",
  region: "Region map",
  city: "City map",
  district: "District map",
  site: "Site map",
  building: "Building map",
  interior: "Interior map",
  other: "Other map",
};
