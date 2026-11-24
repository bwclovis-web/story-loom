import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import {
  dateSortKey,
  emptyCalendarDefs,
  type CalendarDefs,
  type IntercalaryLeapMode,
} from "@/world/calendarDate";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";

const UI_ACTOR = "author";
const TITLE_MAX = 120;
const NAME_MAX = 80;
const SHORT_MAX = 20;
const MAX_MONTHS = 24;
const MAX_ERAS = 32;
const MAX_WEEKDAYS = 31;
const MAX_INTERCALARIES = 24;
const MAX_FESTIVALS = 32;

export interface WorldCalendarMonthView {
  id: string;
  position: number;
  name: string;
  daysInMonth: number;
}

export interface WorldCalendarEraView {
  id: string;
  position: number;
  name: string;
  shortLabel: string;
  yearOffset: number;
  countsDown: boolean;
}

export interface WorldCalendarWeekdayView {
  id: string;
  position: number;
  name: string;
}

export interface WorldCalendarIntercalaryView {
  id: string;
  position: number;
  name: string;
  days: number;
  afterMonthPosition: number;
  leapMode: IntercalaryLeapMode;
}

export interface WorldCalendarFestivalView {
  id: string;
  position: number;
  name: string;
  startMonthPosition: number;
  startDay: number;
  endMonthPosition: number;
  endDay: number;
}

export interface WorldCalendarView {
  id: string;
  projectId: string;
  title: string;
  revision: number;
  leapEveryYears: number | null;
  leapSkipYears: number | null;
  leapIncludeYears: number | null;
  leapOffset: number;
  weekStartOffset: number;
  months: WorldCalendarMonthView[];
  eras: WorldCalendarEraView[];
  weekdays: WorldCalendarWeekdayView[];
  intercalaries: WorldCalendarIntercalaryView[];
  festivals: WorldCalendarFestivalView[];
}

export interface SaveWorldCalendarInput {
  title: string;
  expectedRevision: number;
  leapEveryYears?: number | null;
  leapSkipYears?: number | null;
  leapIncludeYears?: number | null;
  leapOffset?: number;
  weekStartOffset?: number;
  months: { position: number; name: string; daysInMonth: number }[];
  eras: {
    position: number;
    name: string;
    shortLabel?: string;
    yearOffset?: number;
    countsDown?: boolean;
  }[];
  weekdays?: { position: number; name: string }[];
  intercalaries?: {
    position: number;
    name: string;
    days: number;
    afterMonthPosition: number;
    leapMode?: IntercalaryLeapMode;
  }[];
  festivals?: {
    position: number;
    name: string;
    startMonthPosition: number;
    startDay: number;
    endMonthPosition: number;
    endDay: number;
  }[];
}

function rejected(message: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_CHANGE", message)]);
}

function stale(): MutationRejectedError {
  return new MutationRejectedError([
    errorIssue("STALE_REVISION", "The calendar was saved again after you started. The change was not applied."),
  ]);
}

function cleanTitle(title: string): string {
  const value = title.trim();
  if (value.length > TITLE_MAX) throw rejected("Calendar title is too long.");
  return value;
}

function cleanName(name: string, label = "name"): string {
  const value = name.trim();
  if (!value || value.length > NAME_MAX) throw rejected(`Each ${label} needs a name up to 80 characters.`);
  return value;
}

function cleanShort(short: string | undefined): string {
  const value = (short ?? "").trim();
  if (value.length > SHORT_MAX) throw rejected("Era abbreviations can be up to 20 characters.");
  return value;
}

function parseDays(days: number, label = "month"): number {
  if (!Number.isInteger(days) || days < 1 || days > 100) throw rejected(`Each ${label} must have between 1 and 100 days.`);
  return days;
}

function parseIntercalaryDays(days: number): number {
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    throw rejected("Each intercalary period must have between 1 and 30 days.");
  }
  return days;
}

function parseYearOffset(offset: number | undefined): number {
  const value = offset ?? 0;
  if (!Number.isInteger(value) || value < -1_000_000 || value > 1_000_000) {
    throw rejected("Era year offset must be a whole number.");
  }
  return value;
}

function parseOptionalPositive(value: number | null | undefined, label: string): number | null {
  if (value == null || value === 0) return null;
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw rejected(`${label} must be a whole number from 1 to 10000, or empty.`);
  }
  return value;
}

function parseLeapOffset(value: number | undefined): number {
  const offset = value ?? 0;
  if (!Number.isInteger(offset) || offset < -1_000_000 || offset > 1_000_000) {
    throw rejected("Leap year offset must be a whole number.");
  }
  return offset;
}

function parseWeekStartOffset(value: number | undefined, weekdayCount: number): number {
  const offset = value ?? 0;
  if (!Number.isInteger(offset) || offset < 0) throw rejected("Week start must be a whole number.");
  if (weekdayCount === 0) return 0;
  if (offset >= weekdayCount) throw rejected("Week start must be within the weekday list.");
  return offset;
}

function parseLeapMode(mode: string | undefined): IntercalaryLeapMode {
  const value = (mode ?? "always").trim();
  if (value === "always" || value === "leap_only" || value === "non_leap_only") return value;
  throw rejected("Choose always, leap years only, or non-leap years only for intercalary days.");
}

function normalizeMonths(
  input: SaveWorldCalendarInput["months"],
): { position: number; name: string; daysInMonth: number }[] {
  if (!input.length) throw rejected("Add at least one month.");
  if (input.length > MAX_MONTHS) throw rejected(`A calendar can have up to ${MAX_MONTHS} months.`);
  const positions = new Set<number>();
  return input
    .map((row) => {
      if (!Number.isInteger(row.position) || row.position < 1 || row.position > MAX_MONTHS) {
        throw rejected("Month positions must be whole numbers starting at 1.");
      }
      if (positions.has(row.position)) throw rejected("Each month needs a unique position.");
      positions.add(row.position);
      return { position: row.position, name: cleanName(row.name, "month"), daysInMonth: parseDays(row.daysInMonth) };
    })
    .sort((a, b) => a.position - b.position);
}

function normalizeEras(input: SaveWorldCalendarInput["eras"]): {
  position: number;
  name: string;
  shortLabel: string;
  yearOffset: number;
  countsDown: boolean;
}[] {
  if (input.length > MAX_ERAS) throw rejected(`A calendar can have up to ${MAX_ERAS} eras.`);
  const positions = new Set<number>();
  return input
    .map((row) => {
      if (!Number.isInteger(row.position) || row.position < 1 || row.position > MAX_ERAS) {
        throw rejected("Era positions must be whole numbers starting at 1.");
      }
      if (positions.has(row.position)) throw rejected("Each era needs a unique position.");
      positions.add(row.position);
      return {
        position: row.position,
        name: cleanName(row.name, "era"),
        shortLabel: cleanShort(row.shortLabel),
        yearOffset: parseYearOffset(row.yearOffset),
        countsDown: Boolean(row.countsDown),
      };
    })
    .sort((a, b) => a.position - b.position);
}

function normalizeWeekdays(
  input: NonNullable<SaveWorldCalendarInput["weekdays"]>,
): { position: number; name: string }[] {
  if (input.length > MAX_WEEKDAYS) throw rejected(`A calendar can have up to ${MAX_WEEKDAYS} weekdays.`);
  const positions = new Set<number>();
  return input
    .map((row) => {
      if (!Number.isInteger(row.position) || row.position < 1 || row.position > MAX_WEEKDAYS) {
        throw rejected("Weekday positions must be whole numbers starting at 1.");
      }
      if (positions.has(row.position)) throw rejected("Each weekday needs a unique position.");
      positions.add(row.position);
      return { position: row.position, name: cleanName(row.name, "weekday") };
    })
    .sort((a, b) => a.position - b.position);
}

function normalizeIntercalaries(
  input: NonNullable<SaveWorldCalendarInput["intercalaries"]>,
  monthPositions: Set<number>,
): {
  position: number;
  name: string;
  days: number;
  afterMonthPosition: number;
  leapMode: IntercalaryLeapMode;
}[] {
  if (input.length > MAX_INTERCALARIES) {
    throw rejected(`A calendar can have up to ${MAX_INTERCALARIES} intercalary periods.`);
  }
  const positions = new Set<number>();
  return input
    .map((row) => {
      if (!Number.isInteger(row.position) || row.position < 1 || row.position > MAX_INTERCALARIES) {
        throw rejected("Intercalary positions must be whole numbers starting at 1.");
      }
      if (positions.has(row.position)) throw rejected("Each intercalary period needs a unique position.");
      positions.add(row.position);
      if (!Number.isInteger(row.afterMonthPosition) || row.afterMonthPosition < 0) {
        throw rejected("Choose where each intercalary period sits in the year.");
      }
      if (row.afterMonthPosition > 0 && !monthPositions.has(row.afterMonthPosition)) {
        throw rejected("Intercalary periods must sit before the first month or after a defined month.");
      }
      return {
        position: row.position,
        name: cleanName(row.name, "intercalary period"),
        days: parseIntercalaryDays(row.days),
        afterMonthPosition: row.afterMonthPosition,
        leapMode: parseLeapMode(row.leapMode),
      };
    })
    .sort((a, b) => a.position - b.position);
}

function normalizeFestivals(
  input: NonNullable<SaveWorldCalendarInput["festivals"]>,
  months: { position: number; daysInMonth: number }[],
): {
  position: number;
  name: string;
  startMonthPosition: number;
  startDay: number;
  endMonthPosition: number;
  endDay: number;
}[] {
  if (input.length > MAX_FESTIVALS) throw rejected(`A calendar can have up to ${MAX_FESTIVALS} festival periods.`);
  const byPos = new Map(months.map((month) => [month.position, month]));
  const positions = new Set<number>();
  return input
    .map((row) => {
      if (!Number.isInteger(row.position) || row.position < 1 || row.position > MAX_FESTIVALS) {
        throw rejected("Festival positions must be whole numbers starting at 1.");
      }
      if (positions.has(row.position)) throw rejected("Each festival needs a unique position.");
      positions.add(row.position);
      const startMonth = byPos.get(row.startMonthPosition);
      const endMonth = byPos.get(row.endMonthPosition);
      if (!startMonth || !endMonth) throw rejected("Festival start and end must use months from the calendar.");
      if (!Number.isInteger(row.startDay) || row.startDay < 1 || row.startDay > startMonth.daysInMonth) {
        throw rejected(`Festival start day must be between 1 and ${startMonth.daysInMonth}.`);
      }
      if (!Number.isInteger(row.endDay) || row.endDay < 1 || row.endDay > endMonth.daysInMonth) {
        throw rejected(`Festival end day must be between 1 and ${endMonth.daysInMonth}.`);
      }
      return {
        position: row.position,
        name: cleanName(row.name, "festival"),
        startMonthPosition: row.startMonthPosition,
        startDay: row.startDay,
        endMonthPosition: row.endMonthPosition,
        endDay: row.endDay,
      };
    })
    .sort((a, b) => a.position - b.position);
}

function toView(calendar: {
  id: string;
  projectId: string;
  title: string;
  revision: number;
  leapEveryYears?: number | null;
  leapSkipYears?: number | null;
  leapIncludeYears?: number | null;
  leapOffset?: number;
  weekStartOffset?: number;
  months: { id: string; position: number; name: string; daysInMonth: number }[];
  eras: {
    id: string;
    position: number;
    name: string;
    shortLabel: string;
    yearOffset: number;
    countsDown?: boolean;
  }[];
  weekdays?: { id: string; position: number; name: string }[];
  intercalaries?: {
    id: string;
    position: number;
    name: string;
    days: number;
    afterMonthPosition: number;
    leapMode: string;
  }[];
  festivals?: {
    id: string;
    position: number;
    name: string;
    startMonthPosition: number;
    startDay: number;
    endMonthPosition: number;
    endDay: number;
  }[];
}): WorldCalendarView {
  return {
    id: calendar.id,
    projectId: calendar.projectId,
    title: calendar.title,
    revision: calendar.revision,
    leapEveryYears: calendar.leapEveryYears ?? null,
    leapSkipYears: calendar.leapSkipYears ?? null,
    leapIncludeYears: calendar.leapIncludeYears ?? null,
    leapOffset: calendar.leapOffset ?? 0,
    weekStartOffset: calendar.weekStartOffset ?? 0,
    months: calendar.months
      .map((row) => ({
        id: row.id,
        position: row.position,
        name: row.name,
        daysInMonth: row.daysInMonth,
      }))
      .sort((a, b) => a.position - b.position),
    eras: calendar.eras
      .map((row) => ({
        id: row.id,
        position: row.position,
        name: row.name,
        shortLabel: row.shortLabel,
        yearOffset: row.yearOffset,
        countsDown: Boolean(row.countsDown),
      }))
      .sort((a, b) => a.position - b.position),
    weekdays: (calendar.weekdays ?? [])
      .map((row) => ({ id: row.id, position: row.position, name: row.name }))
      .sort((a, b) => a.position - b.position),
    intercalaries: (calendar.intercalaries ?? [])
      .map((row) => ({
        id: row.id,
        position: row.position,
        name: row.name,
        days: row.days,
        afterMonthPosition: row.afterMonthPosition,
        leapMode: parseLeapMode(row.leapMode),
      }))
      .sort((a, b) => a.position - b.position),
    festivals: (calendar.festivals ?? [])
      .map((row) => ({
        id: row.id,
        position: row.position,
        name: row.name,
        startMonthPosition: row.startMonthPosition,
        startDay: row.startDay,
        endMonthPosition: row.endMonthPosition,
        endDay: row.endDay,
      }))
      .sort((a, b) => a.position - b.position),
  };
}

export async function loadWorldCalendar(db: DbOrTx, projectId: string): Promise<WorldCalendarView | null> {
  if (!("worldCalendar" in db)) return null;
  try {
    const row = await db.worldCalendar.findFirst({
      where: { projectId },
      include: {
        months: { orderBy: { position: "asc" } },
        eras: { orderBy: { position: "asc" } },
        weekdays: { orderBy: { position: "asc" } },
        intercalaries: { orderBy: { position: "asc" } },
        festivals: { orderBy: { position: "asc" } },
      },
    });
    return row ? toView(row) : null;
  } catch {
    try {
      const row = await db.worldCalendar.findFirst({
        where: { projectId },
        include: {
          months: { orderBy: { position: "asc" } },
          eras: { orderBy: { position: "asc" } },
        },
      });
      return row ? toView(row) : null;
    } catch {
      return null;
    }
  }
}

export function calendarDefs(calendar: WorldCalendarView | null): CalendarDefs {
  if (!calendar) return emptyCalendarDefs();
  return {
    months: calendar.months.map((month) => ({
      position: month.position,
      name: month.name,
      daysInMonth: month.daysInMonth,
    })),
    eras: calendar.eras.map((era) => ({
      id: era.id,
      position: era.position,
      name: era.name,
      shortLabel: era.shortLabel,
      yearOffset: era.yearOffset,
      countsDown: era.countsDown,
    })),
    weekdays: calendar.weekdays.map((day) => ({ position: day.position, name: day.name })),
    intercalaries: calendar.intercalaries.map((period) => ({
      position: period.position,
      name: period.name,
      days: period.days,
      afterMonthPosition: period.afterMonthPosition,
      leapMode: period.leapMode,
    })),
    festivals: calendar.festivals.map((festival) => ({
      position: festival.position,
      name: festival.name,
      startMonthPosition: festival.startMonthPosition,
      startDay: festival.startDay,
      endMonthPosition: festival.endMonthPosition,
      endDay: festival.endDay,
    })),
    leap: {
      everyYears: calendar.leapEveryYears,
      skipYears: calendar.leapSkipYears,
      includeYears: calendar.leapIncludeYears,
      offset: calendar.leapOffset,
    },
    weekStartOffset: calendar.weekStartOffset,
  };
}

export async function saveWorldCalendar(db: Db, projectId: string, input: SaveWorldCalendarInput): Promise<WorldCalendarView> {
  const title = cleanTitle(input.title);
  const months = normalizeMonths(input.months);
  const eras = normalizeEras(input.eras);
  const weekdays = normalizeWeekdays(input.weekdays ?? []);
  const monthPositions = new Set(months.map((month) => month.position));
  const intercalaries = normalizeIntercalaries(input.intercalaries ?? [], monthPositions);
  const festivals = normalizeFestivals(input.festivals ?? [], months);
  const leapEveryYears = parseOptionalPositive(input.leapEveryYears ?? null, "Leap every N years");
  const leapSkipYears = parseOptionalPositive(input.leapSkipYears ?? null, "Skip leap every M years");
  const leapIncludeYears = parseOptionalPositive(input.leapIncludeYears ?? null, "Restore leap every R years");
  if (leapSkipYears != null && leapEveryYears == null) {
    throw rejected("Set a leap interval before adding a skip rule.");
  }
  if (leapIncludeYears != null && leapSkipYears == null) {
    throw rejected("Set a skip rule before adding a restore rule.");
  }
  const leapOffset = parseLeapOffset(input.leapOffset);
  const weekStartOffset = parseWeekStartOffset(input.weekStartOffset, weekdays.length);
  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const existing = await tx.worldCalendar.findFirst({ where: { projectId }, select: { id: true, revision: true } });
    if (existing) {
      if (existing.revision !== input.expectedRevision) throw stale();
    } else if (input.expectedRevision !== 0) {
      throw stale();
    }
    const calendarId = existing
      ? existing.id
      : (
          await tx.worldCalendar.create({
            data: {
              id: newId("wcal"),
              projectId,
              title,
              revision: 0,
              leapEveryYears,
              leapSkipYears,
              leapIncludeYears,
              leapOffset,
              weekStartOffset,
            },
            select: { id: true },
          })
        ).id;
    if (existing) {
      await tx.storyEvent.updateMany({
        where: { projectId },
        data: {
          structEraId: null,
          structYear: null,
          structMonthPosition: null,
          structIntercalaryPosition: null,
          structDay: null,
        },
      });
      await tx.worldCalendarMonth.deleteMany({ where: { calendarId } });
      await tx.worldCalendarEra.deleteMany({ where: { calendarId } });
      await tx.worldCalendarWeekday.deleteMany({ where: { calendarId } });
      await tx.worldCalendarIntercalary.deleteMany({ where: { calendarId } });
      await tx.worldCalendarFestival.deleteMany({ where: { calendarId } });
      await tx.worldCalendar.update({
        where: { id: calendarId },
        data: {
          title,
          leapEveryYears,
          leapSkipYears,
          leapIncludeYears,
          leapOffset,
          weekStartOffset,
          revision: { increment: 1 },
        },
      });
    } else {
      await tx.worldCalendar.update({
        where: { id: calendarId },
        data: { title, leapEveryYears, leapSkipYears, leapIncludeYears, leapOffset, weekStartOffset },
      });
    }
    await tx.worldCalendarMonth.createMany({
      data: months.map((month) => ({
        id: newId("wcmo"),
        calendarId,
        projectId,
        position: month.position,
        name: month.name,
        daysInMonth: month.daysInMonth,
      })),
    });
    await tx.worldCalendarEra.createMany({
      data: eras.map((era) => ({
        id: newId("wcra"),
        calendarId,
        projectId,
        position: era.position,
        name: era.name,
        shortLabel: era.shortLabel,
        yearOffset: era.yearOffset,
        countsDown: era.countsDown,
      })),
    });
    if (weekdays.length) {
      await tx.worldCalendarWeekday.createMany({
        data: weekdays.map((day) => ({
          id: newId("wcwk"),
          calendarId,
          projectId,
          position: day.position,
          name: day.name,
        })),
      });
    }
    if (intercalaries.length) {
      await tx.worldCalendarIntercalary.createMany({
        data: intercalaries.map((period) => ({
          id: newId("wcin"),
          calendarId,
          projectId,
          position: period.position,
          name: period.name,
          days: period.days,
          afterMonthPosition: period.afterMonthPosition,
          leapMode: period.leapMode,
        })),
      });
    }
    if (festivals.length) {
      await tx.worldCalendarFestival.createMany({
        data: festivals.map((festival) => ({
          id: newId("wcfv"),
          calendarId,
          projectId,
          position: festival.position,
          name: festival.name,
          startMonthPosition: festival.startMonthPosition,
          startDay: festival.startDay,
          endMonthPosition: festival.endMonthPosition,
          endDay: festival.endDay,
        })),
      });
    }
    await writeAudit(tx, {
      projectId,
      action: "world_calendar.save",
      actor: UI_ACTOR,
      summary: existing ? "Updated the in-world calendar" : "Created the in-world calendar",
      details: {
        monthCount: months.length,
        eraCount: eras.length,
        weekdayCount: weekdays.length,
        intercalaryCount: intercalaries.length,
        festivalCount: festivals.length,
      },
    });
    const saved = await tx.worldCalendar.findFirstOrThrow({
      where: { projectId },
      include: {
        months: { orderBy: { position: "asc" } },
        eras: { orderBy: { position: "asc" } },
        weekdays: { orderBy: { position: "asc" } },
        intercalaries: { orderBy: { position: "asc" } },
        festivals: { orderBy: { position: "asc" } },
      },
    });
    return toView(saved);
  });
}

export interface ParsedStructuredDateInput {
  eraId: string | null;
  year: number | null;
  monthPosition: number | null;
  intercalaryPosition?: number | null;
  day: number | null;
}

export function parseStructuredDateInput(
  calendar: WorldCalendarView | null,
  input: {
    useStructured?: boolean;
    eraId?: string;
    year?: string;
    monthPosition?: string;
    day?: string;
    structYear?: string;
    structMonth?: string;
    structIntercalary?: string;
    structSlot?: string;
    structDay?: string;
  },
): ParsedStructuredDateInput {
  const eraRaw = (input.eraId ?? "").trim();
  const yearRaw = (input.structYear ?? input.year ?? "").trim();
  const slotRaw = (input.structSlot ?? "").trim();
  const monthRaw = (input.structMonth ?? input.monthPosition ?? "").trim();
  const intercalaryRaw = (input.structIntercalary ?? "").trim();
  const dayRaw = (input.structDay ?? input.day ?? "").trim();
  let monthPosition: number | null = null;
  let intercalaryPosition: number | null = null;
  if (slotRaw.startsWith("m:")) {
    monthPosition = Number(slotRaw.slice(2));
  } else if (slotRaw.startsWith("i:")) {
    intercalaryPosition = Number(slotRaw.slice(2));
  } else {
    if (monthRaw) monthPosition = Number(monthRaw);
    if (intercalaryRaw) intercalaryPosition = Number(intercalaryRaw);
  }
  const allEmpty =
    !eraRaw && !yearRaw && !dayRaw && monthPosition == null && intercalaryPosition == null && !slotRaw;
  if (input.useStructured === false || (input.useStructured !== true && allEmpty)) {
    return { eraId: null, year: null, monthPosition: null, intercalaryPosition: null, day: null };
  }
  if (!calendar?.months.length) throw rejected("Define the project calendar before setting structured dates.");
  if (allEmpty) return { eraId: null, year: null, monthPosition: null, intercalaryPosition: null, day: null };
  const year = yearRaw ? Number(yearRaw) : null;
  const day = dayRaw ? Number(dayRaw) : null;
  if (year == null || day == null) {
    throw rejected("Structured dates need year and day, or leave them all empty.");
  }
  if (!Number.isInteger(year) || year < 1 || year > 999_999) throw rejected("Year must be a whole number.");
  if (!Number.isInteger(day) || day < 1) throw rejected("Day must be a whole number.");
  if ((monthPosition == null) === (intercalaryPosition == null)) {
    throw rejected("Choose either a month or an intercalary period.");
  }
  let eraId: string | null = null;
  if (eraRaw) {
    const era = calendar.eras.find((item) => item.id === eraRaw);
    if (!era) throw rejected("Choose an era from the calendar.");
    eraId = era.id;
  }
  const defs = calendarDefs(calendar);
  const parts = { eraId, year, monthPosition, intercalaryPosition, day };
  if (dateSortKey(parts, defs) == null) {
    if (intercalaryPosition != null) {
      const period = calendar.intercalaries.find((item) => item.position === intercalaryPosition);
      if (!period) throw rejected("Choose an intercalary period from the calendar.");
      if (day > period.days) throw rejected(`That intercalary period has only ${period.days} days.`);
      throw rejected("That intercalary day is not used in the chosen year (check leap rules).");
    }
    throw rejected("Choose a valid month and day from the calendar.");
  }
  return parts;
}
