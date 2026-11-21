import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import {
  createStoryEvent,
  loadStoryTimeline,
  orderStoryEvents,
  updateStoryEvent,
} from "@/server/services/storyEventService";
import { loadWorldCalendar, saveWorldCalendar } from "@/server/services/worldCalendarService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("world calendar", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("stores structured dates separately from chronology constraints", async () => {
    const calendar = await saveWorldCalendar(t.db, IDS.project, {
      title: "Vale reckoning",
      expectedRevision: 0,
      months: [{ position: 1, name: "Frost", daysInMonth: 30 }],
      eras: [{ position: 1, name: "After Vale", shortLabel: "AV", yearOffset: 0 }],
    });
    const early = await createStoryEvent(t.db, IDS.project, {
      title: "The pact",
      structuredDate: { eraId: null, year: 10, monthPosition: 1, day: 5 },
    });
    const late = await createStoryEvent(t.db, IDS.project, {
      title: "The betrayal",
      structuredDate: { eraId: null, year: 12, monthPosition: 1, day: 1 },
    });
    const detail = await loadStoryTimeline(t.db, IDS.project, { eventId: early.id });
    await orderStoryEvents(t.db, IDS.project, {
      eventId: early.id,
      otherEventId: late.id,
      direction: "before",
      expectedRevision: detail.selected!.revision,
    });
    await updateStoryEvent(t.db, IDS.project, late.id, {
      title: "The betrayal",
      summary: "",
      timeLabel: "",
      planned: false,
      draftScope: "all",
      expectedRevision: 0,
      structuredDate: { eraId: null, year: 8, monthPosition: 1, day: 1 },
    });
    const after = await loadStoryTimeline(t.db, IDS.project, { eventId: late.id });
    expect(after.selected!.dateWarnings).toHaveLength(1);
    expect(await t.db.storyEventOrder.count()).toBe(1);

    const loaded = await loadWorldCalendar(t.db, IDS.project);
    expect(loaded?.months[0]!.name).toBe("Frost");
    expect(calendar.revision).toBe(0);
  });

  it("round-trips calendar and structured dates in backups", async () => {
    await saveWorldCalendar(t.db, IDS.project, {
      title: "Harbor years",
      expectedRevision: 0,
      months: [{ position: 1, name: "Tide", daysInMonth: 28 }],
      eras: [],
    });
    await createStoryEvent(t.db, IDS.project, {
      title: "Storm night",
      structuredDate: { eraId: null, year: 3, monthPosition: 1, day: 14 },
    });
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    const fresh = await createTestDb();
  const outcome = await restoreWorkspaceBackup(fresh.db, backup, { idStrategy: "remap" });
    expect(outcome.ok).toBe(true);
    const calendars = await fresh.db.worldCalendar.findMany();
    expect(calendars).toHaveLength(1);
    expect(calendars[0]!.title).toBe("Harbor years");
    expect(await fresh.db.storyEvent.count({ where: { structDay: 14 } })).toBe(1);
    await fresh.cleanup();
  });
});