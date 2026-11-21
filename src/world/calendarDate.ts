/** In-world calendar math. Does not infer dates from text or manuscript order. */

export interface CalendarMonthDef {
  position: number;
  name: string;
  daysInMonth: number;
}

export interface CalendarEraDef {
  id: string;
  position: number;
  name: string;
  shortLabel: string;
  yearOffset: number;
}

export interface StructuredDateParts {
  eraId: string | null;
  year: number | null;
  monthPosition: number | null;
  day: number | null;
}

export function structuredDateFromRow(row: {
  structEraId: string | null;
  structYear: number | null;
  structMonthPosition: number | null;
  structDay: number | null;
}): StructuredDateParts {
  return {
    eraId: row.structEraId,
    year: row.structYear,
    monthPosition: row.structMonthPosition,
    day: row.structDay,
  };
}

export function structuredDateIsEmpty(parts: StructuredDateParts): boolean {
  return parts.eraId == null && parts.year == null && parts.monthPosition == null && parts.day == null;
}

/** True when year, month, and day are set and valid for the calendar. Era is optional. */
export function structuredDateIsComplete(
  parts: StructuredDateParts,
  months: readonly CalendarMonthDef[],
  eras: readonly CalendarEraDef[],
): boolean {
  return dateSortKey(parts, months, eras) != null;
}

function absoluteYear(parts: StructuredDateParts, eras: readonly CalendarEraDef[]): number | null {
  if (parts.year == null || parts.year < 1 || parts.year > 999_999) return null;
  if (!parts.eraId) return parts.year;
  const era = eras.find((item) => item.id === parts.eraId);
  if (!era) return null;
  return era.yearOffset + (parts.year - 1);
}

function sortedMonths(months: readonly CalendarMonthDef[]): CalendarMonthDef[] {
  return [...months].sort((a, b) => a.position - b.position);
}

export function dateSortKey(
  parts: StructuredDateParts,
  months: readonly CalendarMonthDef[],
  eras: readonly CalendarEraDef[],
): number | null {
  if (parts.year == null || parts.monthPosition == null || parts.day == null) return null;
  const absYear = absoluteYear(parts, eras);
  if (absYear == null) return null;
  const ordered = sortedMonths(months);
  const month = ordered.find((item) => item.position === parts.monthPosition);
  if (!month || parts.day < 1 || parts.day > month.daysInMonth) return null;
  let dayOfYear = parts.day - 1;
  for (const item of ordered) {
    if (item.position === parts.monthPosition) break;
    dayOfYear += item.daysInMonth;
  }
  return absYear * 10_000 + dayOfYear;
}

/** -1, 0, 1, or null when either date is incomplete or invalid. */
export function compareStructuredDates(
  left: StructuredDateParts,
  right: StructuredDateParts,
  months: readonly CalendarMonthDef[],
  eras: readonly CalendarEraDef[],
): number | null {
  const a = dateSortKey(left, months, eras);
  const b = dateSortKey(right, months, eras);
  if (a == null || b == null) return null;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function formatStructuredDate(
  parts: StructuredDateParts,
  months: readonly CalendarMonthDef[],
  eras: readonly CalendarEraDef[],
): string | null {
  if (!structuredDateIsComplete(parts, months, eras)) return null;
  const month = months.find((item) => item.position === parts.monthPosition);
  if (!month || parts.year == null || parts.day == null) return null;
  const era = parts.eraId ? eras.find((item) => item.id === parts.eraId) : null;
  const eraBit = era?.shortLabel.trim() || era?.name.trim() || "";
  const tail = eraBit ? ` ${eraBit}` : "";
  return `${parts.day} ${month.name} ${parts.year}${tail}`;
}