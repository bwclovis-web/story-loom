"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import { saveWorldCalendar, type SaveWorldCalendarInput } from "@/server/services/worldCalendarService";
import type { IntercalaryLeapMode } from "@/world/calendarDate";

export type CalendarFormResult = { ok: true } | { ok: false; issues: Issue[] };

function failure(error: unknown): CalendarFormResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof NotFoundError) return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", error.message)] };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

function optionalInt(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseRows(formData: FormData): SaveWorldCalendarInput {
  const title = String(formData.get("title") ?? "");
  const expectedRevision = Number(formData.get("expectedRevision") ?? "0");
  const monthCount = Number(formData.get("monthCount") ?? "0");
  const months: SaveWorldCalendarInput["months"] = [];
  for (let i = 0; i < monthCount; i++) {
    const name = String(formData.get(`monthName${i}`) ?? "").trim();
    const days = Number(formData.get(`monthDays${i}`) ?? "0");
    if (!name) continue;
    months.push({ position: months.length + 1, name, daysInMonth: days });
  }
  const eraCount = Number(formData.get("eraCount") ?? "0");
  const eras: SaveWorldCalendarInput["eras"] = [];
  for (let i = 0; i < eraCount; i++) {
    const name = String(formData.get(`eraName${i}`) ?? "").trim();
    if (!name) continue;
    eras.push({
      position: eras.length + 1,
      name,
      shortLabel: String(formData.get(`eraShort${i}`) ?? ""),
      yearOffset: Number(formData.get(`eraOffset${i}`) ?? "0"),
      countsDown: formData.get(`eraCountsDown${i}`) === "on",
    });
  }
  const weekdayCount = Number(formData.get("weekdayCount") ?? "0");
  const weekdays: NonNullable<SaveWorldCalendarInput["weekdays"]> = [];
  for (let i = 0; i < weekdayCount; i++) {
    const name = String(formData.get(`weekdayName${i}`) ?? "").trim();
    if (!name) continue;
    weekdays.push({ position: weekdays.length + 1, name });
  }
  const intercalaryCount = Number(formData.get("intercalaryCount") ?? "0");
  const intercalaries: NonNullable<SaveWorldCalendarInput["intercalaries"]> = [];
  for (let i = 0; i < intercalaryCount; i++) {
    const name = String(formData.get(`intercalaryName${i}`) ?? "").trim();
    if (!name) continue;
    intercalaries.push({
      position: intercalaries.length + 1,
      name,
      days: Number(formData.get(`intercalaryDays${i}`) ?? "1"),
      afterMonthPosition: Number(formData.get(`intercalaryAfter${i}`) ?? "0"),
      leapMode: String(formData.get(`intercalaryLeapMode${i}`) ?? "always") as IntercalaryLeapMode,
    });
  }
  const festivalCount = Number(formData.get("festivalCount") ?? "0");
  const festivals: NonNullable<SaveWorldCalendarInput["festivals"]> = [];
  for (let i = 0; i < festivalCount; i++) {
    const name = String(formData.get(`festivalName${i}`) ?? "").trim();
    if (!name) continue;
    festivals.push({
      position: festivals.length + 1,
      name,
      startMonthPosition: Number(formData.get(`festivalStartMonth${i}`) ?? "1"),
      startDay: Number(formData.get(`festivalStartDay${i}`) ?? "1"),
      endMonthPosition: Number(formData.get(`festivalEndMonth${i}`) ?? "1"),
      endDay: Number(formData.get(`festivalEndDay${i}`) ?? "1"),
    });
  }
  return {
    title,
    expectedRevision: Number.isInteger(expectedRevision) ? expectedRevision : 0,
    leapEveryYears: optionalInt(String(formData.get("leapEveryYears") ?? "")),
    leapSkipYears: optionalInt(String(formData.get("leapSkipYears") ?? "")),
    leapIncludeYears: optionalInt(String(formData.get("leapIncludeYears") ?? "")),
    leapOffset: Number(formData.get("leapOffset") ?? "0") || 0,
    weekStartOffset: Number(formData.get("weekStartOffset") ?? "0") || 0,
    months,
    eras,
    weekdays,
    intercalaries,
    festivals,
  };
}

export async function saveWorldCalendarAction(
  projectId: string,
  _prev: CalendarFormResult,
  formData: FormData,
): Promise<CalendarFormResult> {
  try {
    await saveWorldCalendar(getDb(), projectId, parseRows(formData));
    revalidatePath(`/projects/${projectId}/world/calendar`);
    revalidatePath(`/projects/${projectId}/world/events`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
