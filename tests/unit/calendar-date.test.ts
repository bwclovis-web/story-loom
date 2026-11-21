import { describe, expect, it } from "vitest";
import { compareStructuredDates, formatStructuredDate } from "@/world/calendarDate";

const months = [
  { position: 1, name: "Frost", daysInMonth: 30 },
  { position: 2, name: "Bloom", daysInMonth: 30 },
];

const eras = [{ id: "era_av", position: 1, name: "After Vale", shortLabel: "AV", yearOffset: 1000 }];

describe("calendarDate", () => {
  it("compares dates within a month and across eras", () => {
    const early = { eraId: "era_av", year: 5, monthPosition: 1, day: 2 };
    const late = { eraId: "era_av", year: 5, monthPosition: 2, day: 1 };
    expect(compareStructuredDates(early, late, months, eras)).toBe(-1);
    expect(formatStructuredDate(late, months, eras)).toBe("1 Bloom 5 AV");
  });
});