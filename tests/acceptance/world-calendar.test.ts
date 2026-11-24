import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import {
  createStoryEvent,
  loadStoryTimeline,
  orderStoryEvents,
  updateStoryEvent,
} from "@/server/services/storyEventService";
import {
  loadWorldCalendar,
  parseStructuredDateInput,
  saveWorldCalendar,
} from "@/server/services/worldCalendarService";
import { MutationRejectedError } from "@/server/services/errors";
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
      structuredDate: { eraId: null, year: 10, monthPosition: 1, intercalaryPosition: null, day: 5 },
    });
    const late = await createStoryEvent(t.db, IDS.project, {
      title: "The betrayal",
      structuredDate: { eraId: null, year: 12, monthPosition: 1, intercalaryPosition: null, day: 1 },
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
      structuredDate: { eraId: null, year: 8, monthPosition: 1, intercalaryPosition: null, day: 1 },
    });
    const after = await loadStoryTimeline(t.db, IDS.project, { eventId: late.id });
    expect(after.selected!.dateWarnings).toHaveLength(1);
    expect(await t.db.storyEventOrder.count()).toBe(1);

    const loaded = await loadWorldCalendar(t.db, IDS.project);
    expect(loaded?.months[0]!.name).toBe("Frost");
    expect(calendar.revision).toBe(0);
  });

  it("saves weeks, leap rules, intercalary days, festivals, and countdown eras", async () => {
    const saved = await saveWorldCalendar(t.db, IDS.project, {
      title: "Founding reckoning",
      expectedRevision: 0,
      leapEveryYears: 4,
      leapSkipYears: 100,
      leapIncludeYears: 400,
      leapOffset: 0,
      weekStartOffset: 1,
      months: [
        { position: 1, name: "Frost", daysInMonth: 30 },
        { position: 2, name: "Bloom", daysInMonth: 30 },
      ],
      weekdays: [
        { position: 1, name: "Oneday" },
        { position: 2, name: "Twoday" },
        { position: 3, name: "Threeday" },
        { position: 4, name: "Fourday" },
        { position: 5, name: "Fiveday" },
      ],
      intercalaries: [
        { position: 1, name: "Leapfeast", days: 1, afterMonthPosition: 2, leapMode: "leap_only" },
      ],
      festivals: [
        {
          position: 1,
          name: "Yearturn",
          startMonthPosition: 2,
          startDay: 28,
          endMonthPosition: 1,
          endDay: 2,
        },
      ],
      eras: [
        { position: 1, name: "Before Founding", shortLabel: "BF", yearOffset: 0, countsDown: true },
        { position: 2, name: "After Founding", shortLabel: "AF", yearOffset: 1, countsDown: false },
      ],
    });
    expect(saved.weekdays).toHaveLength(5);
    expect(saved.intercalaries[0]!.leapMode).toBe("leap_only");
    expect(saved.festivals[0]!.name).toBe("Yearturn");
    expect(saved.eras[0]!.countsDown).toBe(true);
    expect(saved.leapEveryYears).toBe(4);
    expect(saved.weekStartOffset).toBe(1);

    const leapOk = parseStructuredDateInput(saved, {
      useStructured: true,
      structYear: "4",
      structSlot: "i:1",
      structDay: "1",
      eraId: saved.eras[1]!.id,
    });
    expect(leapOk.intercalaryPosition).toBe(1);

    expect(() =>
      parseStructuredDateInput(saved, {
        useStructured: true,
        structYear: "5",
        structSlot: "i:1",
        structDay: "1",
        eraId: saved.eras[1]!.id,
      }),
    ).toThrow(MutationRejectedError);

    const early = await createStoryEvent(t.db, IDS.project, {
      title: "Old war",
      structuredDate: {
        eraId: saved.eras[0]!.id,
        year: 10,
        monthPosition: 1,
        intercalaryPosition: null,
        day: 1,
      },
    });
    const founding = await createStoryEvent(t.db, IDS.project, {
      title: "Charter sealed",
      structuredDate: {
        eraId: saved.eras[1]!.id,
        year: 1,
        monthPosition: 2,
        intercalaryPosition: null,
        day: 29,
      },
    });
    const timeline = await loadStoryTimeline(t.db, IDS.project, { eventId: founding.id });
    expect(timeline.selected!.structuredDate.formatted).toMatch(/29 Bloom 1 AF/);
    expect(timeline.selected!.structuredDate.festivals).toContain("Yearturn");
    expect(timeline.events.find((event) => event.id === early.id)?.structuredTime).toMatch(/10 BF/);
    const earlyIndex = timeline.events.findIndex((event) => event.id === early.id);
    const foundingIndex = timeline.events.findIndex((event) => event.id === founding.id);
    expect(earlyIndex).toBeLessThan(foundingIndex);
  });

  it("round-trips calendar and structured dates in backups", async () => {
    await saveWorldCalendar(t.db, IDS.project, {
      title: "Harbor years",
      expectedRevision: 0,
      leapEveryYears: 5,
      months: [{ position: 1, name: "Tide", daysInMonth: 28 }],
      weekdays: [
        { position: 1, name: "Dockday" },
        { position: 2, name: "Sailingday" },
      ],
      intercalaries: [{ position: 1, name: "Harborwake", days: 1, afterMonthPosition: 0, leapMode: "always" }],
      festivals: [
        {
          position: 1,
          name: "Lantern Tide",
          startMonthPosition: 1,
          startDay: 1,
          endMonthPosition: 1,
          endDay: 3,
        },
      ],
      eras: [{ position: 1, name: "Harbor Age", shortLabel: "HA", yearOffset: 1, countsDown: false }],
    });
    const calendar = await loadWorldCalendar(t.db, IDS.project);
    await createStoryEvent(t.db, IDS.project, {
      title: "Storm night",
      structuredDate: {
        eraId: calendar!.eras[0]!.id,
        year: 3,
        monthPosition: null,
        intercalaryPosition: 1,
        day: 1,
      },
    });
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.worldCalendars?.[0]?.weekdays).toHaveLength(2);
    expect(backup.worldCalendars?.[0]?.intercalaries?.[0]?.name).toBe("Harborwake");
    expect(backup.storyEvents?.some((event) => event.structIntercalaryPosition === 1)).toBe(true);

    const fresh = await createTestDb();
    const outcome = await restoreWorkspaceBackup(fresh.db, backup, { idStrategy: "remap" });
    expect(outcome.ok).toBe(true);
    const calendars = await fresh.db.worldCalendar.findMany({
      include: { weekdays: true, intercalaries: true, festivals: true, eras: true },
    });
    expect(calendars).toHaveLength(1);
    expect(calendars[0]!.title).toBe("Harbor years");
    expect(calendars[0]!.leapEveryYears).toBe(5);
    expect(calendars[0]!.weekdays).toHaveLength(2);
    expect(calendars[0]!.intercalaries).toHaveLength(1);
    expect(calendars[0]!.festivals).toHaveLength(1);
    expect(await fresh.db.storyEvent.count({ where: { structIntercalaryPosition: 1 } })).toBe(1);
    await fresh.cleanup();
  });

  it("restores older backups that omit the new calendar fields", async () => {
    await saveWorldCalendar(t.db, IDS.project, {
      title: "Simple years",
      expectedRevision: 0,
      months: [{ position: 1, name: "Tide", daysInMonth: 28 }],
      eras: [],
    });
    await createStoryEvent(t.db, IDS.project, {
      title: "Storm night",
      structuredDate: { eraId: null, year: 3, monthPosition: 1, intercalaryPosition: null, day: 14 },
    });
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    const slim = structuredClone(backup);
    if (slim.worldCalendars?.[0]) {
      delete slim.worldCalendars[0].weekdays;
      delete slim.worldCalendars[0].intercalaries;
      delete slim.worldCalendars[0].festivals;
      delete slim.worldCalendars[0].leapEveryYears;
      delete slim.worldCalendars[0].weekStartOffset;
      for (const era of slim.worldCalendars[0].eras ?? []) delete era.countsDown;
    }
    for (const event of slim.storyEvents ?? []) delete event.structIntercalaryPosition;

    const fresh = await createTestDb();
    const outcome = await restoreWorkspaceBackup(fresh.db, slim, { idStrategy: "remap" });
    expect(outcome.ok).toBe(true);
    expect(await fresh.db.worldCalendarWeekday.count()).toBe(0);
    expect(await fresh.db.storyEvent.count({ where: { structDay: 14 } })).toBe(1);
    await fresh.cleanup();
  });
});
