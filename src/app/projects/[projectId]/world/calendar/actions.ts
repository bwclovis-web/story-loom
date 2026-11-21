"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import { saveWorldCalendar, type SaveWorldCalendarInput } from "@/server/services/worldCalendarService";

export type CalendarFormResult = { ok: true } | { ok: false; issues: Issue[] };

function failure(error: unknown): CalendarFormResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof NotFoundError) return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", error.message)] };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
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
    });
  }
  return { title, expectedRevision: Number.isInteger(expectedRevision) ? expectedRevision : 0, months, eras };
}

export async function saveWorldCalendarAction(projectId: string, _prev: CalendarFormResult, formData: FormData): Promise<CalendarFormResult> {
  try {
    await saveWorldCalendar(getDb(), projectId, parseRows(formData));
    revalidatePath(`/projects/${projectId}/world/calendar`);
    revalidatePath(`/projects/${projectId}/world/events`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}