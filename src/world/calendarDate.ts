/** In-world calendar math. Does not infer dates from text or manuscript order. */

export type IntercalaryLeapMode = "always" | "leap_only" | "non_leap_only";

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
  /** When true, year N is N years before the epoch year (yearOffset maps era year 1). */
  countsDown: boolean;
}

export interface CalendarWeekdayDef {
  position: number;
  name: string;
}

export interface CalendarIntercalaryDef {
  position: number;
  name: string;
  days: number;
  /** 0 = before first month; otherwise after that month position. */
  afterMonthPosition: number;
  leapMode: IntercalaryLeapMode;
}

export interface CalendarFestivalDef {
  position: number;
  name: string;
  startMonthPosition: number;
  startDay: number;
  endMonthPosition: number;
  endDay: number;
}

export interface CalendarLeapRule {
  everyYears: number | null;
  skipYears: number | null;
  includeYears: number | null;
  offset: number;
}

export interface CalendarDefs {
  months: readonly CalendarMonthDef[];
  eras: readonly CalendarEraDef[];
  weekdays: readonly CalendarWeekdayDef[];
  intercalaries: readonly CalendarIntercalaryDef[];
  festivals: readonly CalendarFestivalDef[];
  leap: CalendarLeapRule;
  weekStartOffset: number;
}

export interface StructuredDateParts {
  eraId: string | null;
  year: number | null;
  monthPosition: number | null;
  intercalaryPosition: number | null;
  day: number | null;
}

export type YearSlot =
  | { kind: "month"; month: CalendarMonthDef; dayOfYearStart: number }
  | { kind: "intercalary"; period: CalendarIntercalaryDef; dayOfYearStart: number };

export function emptyCalendarDefs(): CalendarDefs {
  return {
    months: [],
    eras: [],
    weekdays: [],
    intercalaries: [],
    festivals: [],
    leap: { everyYears: null, skipYears: null, includeYears: null, offset: 0 },
    weekStartOffset: 0,
  };
}

export function structuredDateFromRow(row: {
  structEraId: string | null;
  structYear: number | null;
  structMonthPosition: number | null;
  structIntercalaryPosition?: number | null;
  structDay: number | null;
}): StructuredDateParts {
  return {
    eraId: row.structEraId,
    year: row.structYear,
    monthPosition: row.structMonthPosition,
    intercalaryPosition: row.structIntercalaryPosition ?? null,
    day: row.structDay,
  };
}

export function structuredDateIsEmpty(parts: StructuredDateParts): boolean {
  return (
    parts.eraId == null &&
    parts.year == null &&
    parts.monthPosition == null &&
    parts.intercalaryPosition == null &&
    parts.day == null
  );
}

/** True when year, day, and either month or intercalary are set and valid. Era is optional. */
export function structuredDateIsComplete(parts: StructuredDateParts, defs: CalendarDefs): boolean {
  return dateSortKey(parts, defs) != null;
}

function euclidMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function isCalendarLeapYear(absYear: number, leap: CalendarLeapRule): boolean {
  if (leap.everyYears == null || leap.everyYears < 1) return false;
  const relative = absYear - leap.offset;
  if (euclidMod(relative, leap.everyYears) !== 0) return false;
  if (leap.skipYears != null && leap.skipYears > 0 && euclidMod(relative, leap.skipYears) === 0) {
    if (leap.includeYears != null && leap.includeYears > 0 && euclidMod(relative, leap.includeYears) === 0) {
      return true;
    }
    return false;
  }
  return true;
}

/** Count of leap years with absolute year in [fromInclusive, toExclusive). */
function leapCountInRange(fromInclusive: number, toExclusive: number, leap: CalendarLeapRule): number {
  if (leap.everyYears == null || leap.everyYears < 1) return 0;
  if (toExclusive <= fromInclusive) return 0;
  const every = leap.everyYears;
  const first = Math.ceil((fromInclusive - leap.offset) / every) * every + leap.offset;
  if (first >= toExclusive) return 0;
  const last = Math.floor((toExclusive - 1 - leap.offset) / every) * every + leap.offset;
  if (last < first) return 0;
  let count = Math.floor((last - first) / every) + 1;
  if (leap.skipYears != null && leap.skipYears > 0) {
    const skip = leap.skipYears;
    const firstSkip = Math.ceil((fromInclusive - leap.offset) / skip) * skip + leap.offset;
    if (firstSkip < toExclusive) {
      const lastSkip = Math.floor((toExclusive - 1 - leap.offset) / skip) * skip + leap.offset;
      if (lastSkip >= firstSkip) {
        let skipCount = Math.floor((lastSkip - firstSkip) / skip) + 1;
        if (leap.includeYears != null && leap.includeYears > 0) {
          const include = leap.includeYears;
          const firstInc = Math.ceil((fromInclusive - leap.offset) / include) * include + leap.offset;
          if (firstInc < toExclusive) {
            const lastInc = Math.floor((toExclusive - 1 - leap.offset) / include) * include + leap.offset;
            if (lastInc >= firstInc) {
              const restore = Math.floor((lastInc - firstInc) / include) + 1;
              skipCount -= restore;
            }
          }
        }
        count -= skipCount;
      }
    }
  }
  return Math.max(0, count);
}

function intercalaryActive(period: CalendarIntercalaryDef, leap: boolean): boolean {
  if (period.leapMode === "always") return true;
  if (period.leapMode === "leap_only") return leap;
  return !leap;
}

function sortedMonths(months: readonly CalendarMonthDef[]): CalendarMonthDef[] {
  return [...months].sort((a, b) => a.position - b.position);
}

function sortedIntercalaries(rows: readonly CalendarIntercalaryDef[]): CalendarIntercalaryDef[] {
  return [...rows].sort((a, b) => a.position - b.position || a.afterMonthPosition - b.afterMonthPosition);
}

function baseMonthDays(months: readonly CalendarMonthDef[]): number {
  return months.reduce((sum, month) => sum + month.daysInMonth, 0);
}

function intercalaryDaysForYear(absYear: number, defs: CalendarDefs): number {
  const leap = isCalendarLeapYear(absYear, defs.leap);
  return defs.intercalaries.reduce((sum, period) => (intercalaryActive(period, leap) ? sum + period.days : sum), 0);
}

export function daysInAbsoluteYear(absYear: number, defs: CalendarDefs): number {
  return baseMonthDays(defs.months) + intercalaryDaysForYear(absYear, defs);
}

/**
 * Total days in absolute years strictly before `absYear`.
 * Origin: start of absolute year 1 = day index 0 (O(1) via floored leap counts).
 */
export function daysBeforeAbsoluteYear(absYear: number, defs: CalendarDefs): number {
  const monthDays = baseMonthDays(defs.months);
  const alwaysExtra = defs.intercalaries
    .filter((period) => period.leapMode === "always")
    .reduce((sum, period) => sum + period.days, 0);
  const leapOnlyExtra = defs.intercalaries
    .filter((period) => period.leapMode === "leap_only")
    .reduce((sum, period) => sum + period.days, 0);
  const nonLeapExtra = defs.intercalaries
    .filter((period) => period.leapMode === "non_leap_only")
    .reduce((sum, period) => sum + period.days, 0);
  const yearSpanDays = (fromInclusive: number, toExclusive: number): number => {
    if (toExclusive <= fromInclusive) return 0;
    const yearCount = toExclusive - fromInclusive;
    const leapDays = leapCountInRange(fromInclusive, toExclusive, defs.leap);
    return yearCount * monthDays + yearCount * alwaysExtra + leapDays * leapOnlyExtra + (yearCount - leapDays) * nonLeapExtra;
  };
  if (absYear >= 1) return yearSpanDays(1, absYear);
  return -yearSpanDays(absYear, 1);
}

export function calendarYearSlots(absYear: number, defs: CalendarDefs): YearSlot[] {
  const leap = isCalendarLeapYear(absYear, defs.leap);
  const months = sortedMonths(defs.months);
  const intercalaries = sortedIntercalaries(defs.intercalaries);
  const slots: YearSlot[] = [];
  let dayOfYear = 0;
  const placeIntercalary = (afterMonth: number) => {
    for (const period of intercalaries) {
      if (period.afterMonthPosition !== afterMonth) continue;
      if (!intercalaryActive(period, leap)) continue;
      slots.push({ kind: "intercalary", period, dayOfYearStart: dayOfYear });
      dayOfYear += period.days;
    }
  };
  placeIntercalary(0);
  for (const month of months) {
    slots.push({ kind: "month", month, dayOfYearStart: dayOfYear });
    dayOfYear += month.daysInMonth;
    placeIntercalary(month.position);
  }
  return slots;
}

export function absoluteYear(parts: StructuredDateParts, eras: readonly CalendarEraDef[]): number | null {
  if (parts.year == null || parts.year < 1 || parts.year > 999_999) return null;
  if (!parts.eraId) return parts.year;
  const era = eras.find((item) => item.id === parts.eraId);
  if (!era) return null;
  if (era.countsDown) return era.yearOffset - (parts.year - 1);
  return era.yearOffset + (parts.year - 1);
}

function dayOfYearForParts(parts: StructuredDateParts, absYear: number, defs: CalendarDefs): number | null {
  if (parts.day == null || parts.day < 1) return null;
  const hasMonth = parts.monthPosition != null;
  const hasIntercalary = parts.intercalaryPosition != null;
  if (hasMonth === hasIntercalary) return null;
  const slots = calendarYearSlots(absYear, defs);
  if (hasMonth) {
    const slot = slots.find((item) => item.kind === "month" && item.month.position === parts.monthPosition);
    if (!slot || slot.kind !== "month") return null;
    if (parts.day > slot.month.daysInMonth) return null;
    return slot.dayOfYearStart + parts.day - 1;
  }
  const slot = slots.find((item) => item.kind === "intercalary" && item.period.position === parts.intercalaryPosition);
  if (!slot || slot.kind !== "intercalary") return null;
  if (parts.day > slot.period.days) return null;
  return slot.dayOfYearStart + parts.day - 1;
}

export function dateSortKey(parts: StructuredDateParts, defs: CalendarDefs): number | null {
  if (parts.year == null || parts.day == null) return null;
  const absYear = absoluteYear(parts, defs.eras);
  if (absYear == null) return null;
  const dayOfYear = dayOfYearForParts(parts, absYear, defs);
  if (dayOfYear == null || dayOfYear < 0 || dayOfYear > 9999) return null;
  return absYear * 10_000 + dayOfYear;
}

/** -1, 0, 1, or null when either date is incomplete or invalid. */
export function compareStructuredDates(
  left: StructuredDateParts,
  right: StructuredDateParts,
  defs: CalendarDefs,
): number | null {
  const a = dateSortKey(left, defs);
  const b = dateSortKey(right, defs);
  if (a == null || b == null) return null;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function weekdayForStructuredDate(parts: StructuredDateParts, defs: CalendarDefs): string | null {
  if (!defs.weekdays.length) return null;
  const key = dateSortKey(parts, defs);
  if (key == null) return null;
  const absYear = absoluteYear(parts, defs.eras);
  if (absYear == null) return null;
  const dayOfYear = dayOfYearForParts(parts, absYear, defs);
  if (dayOfYear == null) return null;
  const total = daysBeforeAbsoluteYear(absYear, defs) + dayOfYear + defs.weekStartOffset;
  const ordered = [...defs.weekdays].sort((a, b) => a.position - b.position);
  const index = euclidMod(total, ordered.length);
  return ordered[index]?.name ?? null;
}

function monthDayOfYear(
  monthPosition: number,
  day: number,
  absYear: number,
  defs: CalendarDefs,
): number | null {
  return dayOfYearForParts(
    { eraId: null, year: 1, monthPosition, intercalaryPosition: null, day },
    absYear,
    defs,
  );
}

export function festivalsForStructuredDate(parts: StructuredDateParts, defs: CalendarDefs): string[] {
  if (!defs.festivals.length) return [];
  const absYear = absoluteYear(parts, defs.eras);
  if (absYear == null) return [];
  const dayOfYear = dayOfYearForParts(parts, absYear, defs);
  if (dayOfYear == null) return [];
  const names: string[] = [];
  for (const festival of [...defs.festivals].sort((a, b) => a.position - b.position)) {
    const start = monthDayOfYear(festival.startMonthPosition, festival.startDay, absYear, defs);
    const end = monthDayOfYear(festival.endMonthPosition, festival.endDay, absYear, defs);
    if (start == null || end == null) continue;
    const inSpan = start <= end ? dayOfYear >= start && dayOfYear <= end : dayOfYear >= start || dayOfYear <= end;
    if (inSpan) names.push(festival.name);
  }
  return names;
}

export function formatStructuredDate(parts: StructuredDateParts, defs: CalendarDefs): string | null {
  if (!structuredDateIsComplete(parts, defs)) return null;
  if (parts.year == null || parts.day == null) return null;
  const era = parts.eraId ? defs.eras.find((item) => item.id === parts.eraId) : null;
  const eraBit = era?.shortLabel.trim() || era?.name.trim() || "";
  const tail = eraBit ? ` ${eraBit}` : "";
  let core: string;
  if (parts.intercalaryPosition != null) {
    const period = defs.intercalaries.find((item) => item.position === parts.intercalaryPosition);
    if (!period) return null;
    core = period.days === 1 ? `${period.name} ${parts.year}${tail}` : `${parts.day} ${period.name} ${parts.year}${tail}`;
  } else {
    const month = defs.months.find((item) => item.position === parts.monthPosition);
    if (!month) return null;
    core = `${parts.day} ${month.name} ${parts.year}${tail}`;
  }
  const weekday = weekdayForStructuredDate(parts, defs);
  return weekday ? `${core} · ${weekday}` : core;
}
