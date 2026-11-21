import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import type { CalendarEraDef, CalendarMonthDef } from "@/world/calendarDate";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";

const UI_ACTOR = "author";
const TITLE_MAX = 120;
const NAME_MAX = 80;
const SHORT_MAX = 20;
const MAX_MONTHS = 24;
const MAX_ERAS = 32;

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
}

export interface WorldCalendarView {
  id: string;
  projectId: string;
  title: string;
  revision: number;
  months: WorldCalendarMonthView[];
  eras: WorldCalendarEraView[];
}

export interface SaveWorldCalendarInput {
  title: string;
  expectedRevision: number;
  months: { position: number; name: string; daysInMonth: number }[];
  eras: { position: number; name: string; shortLabel?: string; yearOffset?: number }[];
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

function cleanName(name: string): string {
  const value = name.trim();
  if (!value || value.length > NAME_MAX) throw rejected("Each month and era needs a name up to 80 characters.");
  return value;
}

function cleanShort(short: string | undefined): string {
  const value = (short ?? "").trim();
  if (value.length > SHORT_MAX) throw rejected("Era abbreviations can be up to 20 characters.");
  return value;
}

function parseDays(days: number): number {
  if (!Number.isInteger(days) || days < 1 || days > 100) throw rejected("Each month must have between 1 and 100 days.");
  return days;
}

function parseYearOffset(offset: number | undefined): number {
  const value = offset ?? 0;
  if (!Number.isInteger(value) || value < -1_000_000 || value > 1_000_000) {
    throw rejected("Era year offset must be a whole number.");
  }
  return value;
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
      return { position: row.position, name: cleanName(row.name), daysInMonth: parseDays(row.daysInMonth) };
    })
    .sort((a, b) => a.position - b.position);
}

function normalizeEras(input: SaveWorldCalendarInput["eras"]): SaveWorldCalendarInput["eras"] {
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
        name: cleanName(row.name),
        shortLabel: cleanShort(row.shortLabel),
        yearOffset: parseYearOffset(row.yearOffset),
      };
    })
    .sort((a, b) => a.position - b.position);
}

function toView(calendar: {
  id: string;
  projectId: string;
  title: string;
  revision: number;
  months: { id: string; position: number; name: string; daysInMonth: number }[];
  eras: { id: string; position: number; name: string; shortLabel: string; yearOffset: number }[];
}): WorldCalendarView {
  return {
    id: calendar.id,
    projectId: calendar.projectId,
    title: calendar.title,
    revision: calendar.revision,
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
      },
    });
    return row ? toView(row) : null;
  } catch {
    return null;
  }
}

export function calendarDefs(calendar: WorldCalendarView | null): {
  months: CalendarMonthDef[];
  eras: CalendarEraDef[];
} {
  if (!calendar) return { months: [], eras: [] };
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
    })),
  };
}

export async function saveWorldCalendar(db: Db, projectId: string, input: SaveWorldCalendarInput): Promise<WorldCalendarView> {
  const title = cleanTitle(input.title);
  const months = normalizeMonths(input.months);
  const eras = normalizeEras(input.eras);
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
            data: { id: newId("wcal"), projectId, title, revision: 0 },
            select: { id: true },
          })
        ).id;
    if (existing) {
      await tx.storyEvent.updateMany({
        where: { projectId },
        data: { structEraId: null, structYear: null, structMonthPosition: null, structDay: null },
      });
      await tx.worldCalendarMonth.deleteMany({ where: { calendarId } });
      await tx.worldCalendarEra.deleteMany({ where: { calendarId } });
      await tx.worldCalendar.update({ where: { id: calendarId }, data: { title, revision: { increment: 1 } } });
    } else {
      await tx.worldCalendar.update({ where: { id: calendarId }, data: { title } });
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
        shortLabel: era.shortLabel ?? "",
        yearOffset: era.yearOffset ?? 0,
      })),
    });
    await writeAudit(tx, {
      projectId,
      action: "world_calendar.save",
      actor: UI_ACTOR,
      summary: existing ? "Updated the in-world calendar" : "Created the in-world calendar",
      details: { monthCount: months.length, eraCount: eras.length },
    });
    const saved = await tx.worldCalendar.findFirstOrThrow({
      where: { projectId },
      include: { months: { orderBy: { position: "asc" } }, eras: { orderBy: { position: "asc" } } },
    });
    return toView(saved);
  });
}

export interface ParsedStructuredDateInput {
  eraId: string | null;
  year: number | null;
  monthPosition: number | null;
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
    structDay?: string;
  },
): ParsedStructuredDateInput {
  const eraRaw = (input.eraId ?? "").trim();
  const yearRaw = (input.structYear ?? input.year ?? "").trim();
  const monthRaw = (input.structMonth ?? input.monthPosition ?? "").trim();
  const dayRaw = (input.structDay ?? input.day ?? "").trim();
  const allEmpty = !eraRaw && !yearRaw && !monthRaw && !dayRaw;
  if (input.useStructured === false || (input.useStructured !== true && allEmpty)) {
    return { eraId: null, year: null, monthPosition: null, day: null };
  }
  if (!calendar?.months.length) throw rejected("Define the project calendar before setting structured dates.");
  if (allEmpty) return { eraId: null, year: null, monthPosition: null, day: null };
  const year = yearRaw ? Number(yearRaw) : null;
  const monthPosition = monthRaw ? Number(monthRaw) : null;
  const day = dayRaw ? Number(dayRaw) : null;
  if (year == null || monthPosition == null || day == null) {
    throw rejected("Structured dates need year, month, and day, or leave them all empty.");
  }
  if (!Number.isInteger(year) || year < 1 || year > 999_999) throw rejected("Year must be a whole number.");
  if (!Number.isInteger(monthPosition) || monthPosition < 1) throw rejected("Choose a month from the calendar.");
  if (!Number.isInteger(day) || day < 1) throw rejected("Day must be a whole number.");
  if (!calendar.months.some((month) => month.position === monthPosition)) throw rejected("Choose a month from the calendar.");
  const month = calendar.months.find((item) => item.position === monthPosition)!;
  if (day > month.daysInMonth) throw rejected(`That month has only ${month.daysInMonth} days.`);
  let eraId: string | null = null;
  if (eraRaw) {
    const era = calendar.eras.find((item) => item.id === eraRaw);
    if (!era) throw rejected("Choose an era from the calendar.");
    eraId = era.id;
  }
  return { eraId, year, monthPosition, day };
}