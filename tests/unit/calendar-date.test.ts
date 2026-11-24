import { describe, expect, it } from "vitest";
import {
  compareStructuredDates,
  daysInAbsoluteYear,
  emptyCalendarDefs,
  festivalsForStructuredDate,
  formatStructuredDate,
  isCalendarLeapYear,
  weekdayForStructuredDate,
  type CalendarDefs,
} from "@/world/calendarDate";

const months = [
  { position: 1, name: "Frost", daysInMonth: 30 },
  { position: 2, name: "Bloom", daysInMonth: 30 },
];

function defs(partial: Partial<CalendarDefs> = {}): CalendarDefs {
  return {
    ...emptyCalendarDefs(),
    months,
    eras: [{ id: "era_av", position: 1, name: "After Vale", shortLabel: "AV", yearOffset: 1000, countsDown: false }],
    ...partial,
  };
}

describe("calendarDate", () => {
  it("compares dates within a month and across eras", () => {
    const calendar = defs();
    const early = { eraId: "era_av", year: 5, monthPosition: 1, intercalaryPosition: null, day: 2 };
    const late = { eraId: "era_av", year: 5, monthPosition: 2, intercalaryPosition: null, day: 1 };
    expect(compareStructuredDates(early, late, calendar)).toBe(-1);
    expect(formatStructuredDate(late, calendar)).toBe("1 Bloom 5 AV");
  });

  it("names weekdays across month and intercalary boundaries", () => {
    const calendar = defs({
      weekdays: [
        { position: 1, name: "Oneday" },
        { position: 2, name: "Twoday" },
        { position: 3, name: "Threeday" },
        { position: 4, name: "Fourday" },
        { position: 5, name: "Fiveday" },
      ],
      weekStartOffset: 0,
      intercalaries: [
        {
          position: 1,
          name: "Midwinter",
          days: 2,
          afterMonthPosition: 1,
          leapMode: "always",
        },
      ],
    });
    const first = { eraId: null, year: 1, monthPosition: 1, intercalaryPosition: null, day: 1 };
    expect(weekdayForStructuredDate(first, calendar)).toBe("Oneday");
    expect(formatStructuredDate(first, calendar)).toBe("1 Frost 1 · Oneday");
    const midwinter = { eraId: null, year: 1, monthPosition: null, intercalaryPosition: 1, day: 1 };
    expect(formatStructuredDate(midwinter, calendar)).toMatch(/Midwinter 1 · /);
    expect(weekdayForStructuredDate(midwinter, calendar)).toBeTruthy();
  });

  it("applies leap-only intercalary days and Gregorian-style skip/include", () => {
    const calendar = defs({
      leap: { everyYears: 4, skipYears: 100, includeYears: 400, offset: 0 },
      intercalaries: [
        { position: 1, name: "Leapfeast", days: 1, afterMonthPosition: 2, leapMode: "leap_only" },
      ],
    });
    expect(isCalendarLeapYear(4, calendar.leap)).toBe(true);
    expect(isCalendarLeapYear(100, calendar.leap)).toBe(false);
    expect(isCalendarLeapYear(400, calendar.leap)).toBe(true);
    expect(daysInAbsoluteYear(4, calendar)).toBe(61);
    expect(daysInAbsoluteYear(100, calendar)).toBe(60);
    const leapDay = { eraId: null, year: 4, monthPosition: null, intercalaryPosition: 1, day: 1 };
    const nonLeapDay = { eraId: null, year: 100, monthPosition: null, intercalaryPosition: 1, day: 1 };
    expect(formatStructuredDate(leapDay, calendar)).toBe("Leapfeast 4");
    expect(formatStructuredDate(nonLeapDay, calendar)).toBeNull();
  });

  it("labels festival spans including year-end wrap without adding days", () => {
    const calendar = defs({
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
    });
    expect(daysInAbsoluteYear(1, calendar)).toBe(60);
    const late = { eraId: null, year: 1, monthPosition: 2, intercalaryPosition: null, day: 29 };
    const early = { eraId: null, year: 1, monthPosition: 1, intercalaryPosition: null, day: 2 };
    const mid = { eraId: null, year: 1, monthPosition: 1, intercalaryPosition: null, day: 10 };
    expect(festivalsForStructuredDate(late, calendar)).toEqual(["Yearturn"]);
    expect(festivalsForStructuredDate(early, calendar)).toEqual(["Yearturn"]);
    expect(festivalsForStructuredDate(mid, calendar)).toEqual([]);
  });

  it("orders countdown eras before the foundational epoch", () => {
    const calendar = defs({
      eras: [
        { id: "era_bf", position: 1, name: "Before Founding", shortLabel: "BF", yearOffset: 0, countsDown: true },
        { id: "era_af", position: 2, name: "After Founding", shortLabel: "AF", yearOffset: 1, countsDown: false },
      ],
    });
    const tenBf = { eraId: "era_bf", year: 10, monthPosition: 1, intercalaryPosition: null, day: 1 };
    const twoBf = { eraId: "era_bf", year: 2, monthPosition: 1, intercalaryPosition: null, day: 1 };
    const oneBf = { eraId: "era_bf", year: 1, monthPosition: 1, intercalaryPosition: null, day: 1 };
    const oneAf = { eraId: "era_af", year: 1, monthPosition: 1, intercalaryPosition: null, day: 1 };
    expect(compareStructuredDates(tenBf, twoBf, calendar)).toBe(-1);
    expect(compareStructuredDates(twoBf, oneBf, calendar)).toBe(-1);
    expect(compareStructuredDates(oneBf, oneAf, calendar)).toBe(-1);
    expect(formatStructuredDate(twoBf, calendar)).toBe("1 Frost 2 BF");
    expect(formatStructuredDate(oneAf, calendar)).toBe("1 Frost 1 AF");
  });
});
