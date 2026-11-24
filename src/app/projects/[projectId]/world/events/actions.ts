"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import {
  addStoryEventEvidence,
  createStoryEvent,
  linkStoryEventLocation,
  linkStoryEventScene,
  listEventsForLocation,
  orderStoryEvents,
  removeStoryEventEvidence,
  removeStoryEventOrder,
  unlinkStoryEventLocation,
  unlinkStoryEventScene,
  updateStoryEvent,
  type PlaceEventItem,
} from "@/server/services/storyEventService";
import { loadWorldCalendar, parseStructuredDateInput } from "@/server/services/worldCalendarService";

type EventFormInput = {
  title: string;
  summary: string;
  timeLabel: string;
  planned: boolean;
  draftScope: string;
  useStructured?: boolean;
  eraId?: string;
  structYear?: string;
  structMonth?: string;
  structIntercalary?: string;
  structSlot?: string;
  structDay?: string;
};

function failure(error: unknown): { ok: false; issues: Issue[] } {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof NotFoundError) return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", error.message)] };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

function revalidateEvents(projectId: string) {
  revalidatePath(`/projects/${projectId}/world/events`);
  revalidatePath(`/projects/${projectId}/world/maps`);
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function listEventsAtLocationAction(
  projectId: string,
  locationRecordId: string,
): Promise<{ ok: true; events: PlaceEventItem[] } | { ok: false; issues: Issue[] }> {
  try {
    const events = await listEventsForLocation(getDb(), projectId, locationRecordId);
    return { ok: true, events };
  } catch (error) {
    return failure(error);
  }
}

export async function createStoryEventAction(
  projectId: string,
  input: EventFormInput,
): Promise<{ ok: true; id: string } | { ok: false; issues: Issue[] }> {
  try {
    const calendar = await loadWorldCalendar(getDb(), projectId);
    const structuredDate = parseStructuredDateInput(calendar, input);
    const created = await createStoryEvent(getDb(), projectId, { ...input, structuredDate });
    revalidateEvents(projectId);
    return { ok: true, id: created.id };
  } catch (error) {
    return failure(error);
  }
}

export async function updateStoryEventAction(
  projectId: string,
  eventId: string,
  input: EventFormInput & { expectedRevision: number },
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  try {
    const calendar = await loadWorldCalendar(getDb(), projectId);
    const structuredDate = parseStructuredDateInput(calendar, input);
    await updateStoryEvent(getDb(), projectId, eventId, { ...input, structuredDate });
    revalidateEvents(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function linkStoryEventLocationAction(
  projectId: string,
  eventId: string,
  locationRecordId: string,
  expectedRevision: number,
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  try {
    await linkStoryEventLocation(getDb(), projectId, eventId, locationRecordId, expectedRevision);
    revalidateEvents(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function unlinkStoryEventLocationAction(
  projectId: string,
  eventId: string,
  linkId: string,
  expectedRevision: number,
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  try {
    await unlinkStoryEventLocation(getDb(), projectId, eventId, linkId, expectedRevision);
    revalidateEvents(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function linkStoryEventSceneAction(
  projectId: string,
  eventId: string,
  manuscriptRecordId: string,
  expectedRevision: number,
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  try {
    await linkStoryEventScene(getDb(), projectId, eventId, manuscriptRecordId, expectedRevision);
    revalidateEvents(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function unlinkStoryEventSceneAction(
  projectId: string,
  eventId: string,
  linkId: string,
  expectedRevision: number,
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  try {
    await unlinkStoryEventScene(getDb(), projectId, eventId, linkId, expectedRevision);
    revalidateEvents(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function orderStoryEventsAction(
  projectId: string,
  input: { eventId: string; otherEventId: string; direction: "before" | "after"; expectedRevision: number },
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  try {
    await orderStoryEvents(getDb(), projectId, input);
    revalidateEvents(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function removeStoryEventOrderAction(
  projectId: string,
  eventId: string,
  orderId: string,
  expectedRevision: number,
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  try {
    await removeStoryEventOrder(getDb(), projectId, eventId, orderId, expectedRevision);
    revalidateEvents(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function addStoryEventEvidenceAction(
  projectId: string,
  eventId: string,
  input: { sourceRecordId: string; passageStart: number; passageEnd: number; expectedRevision: number },
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  try {
    await addStoryEventEvidence(getDb(), projectId, eventId, input);
    revalidateEvents(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function removeStoryEventEvidenceAction(
  projectId: string,
  eventId: string,
  evidenceId: string,
  expectedRevision: number,
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  try {
    await removeStoryEventEvidence(getDb(), projectId, eventId, evidenceId, expectedRevision);
    revalidateEvents(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
