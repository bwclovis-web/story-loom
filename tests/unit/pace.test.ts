import { describe, expect, it } from "vitest";
import { dailyPaceTarget, fillDayRange, writingStreak } from "@/writing/pace";

describe("writing pace", () => {
  const today = new Date(2026, 10, 21);

  it("fills thirty days and counts a streak that skips an empty today", () => {
    const days = fillDayRange(
      [
        { at: new Date(2026, 10, 19), words: 100 },
        { at: new Date(2026, 10, 20), words: 50 },
      ],
      today,
      30,
    );
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toEqual({ iso: "2026-11-21", words: 0 });
    expect(days.at(-2)?.words).toBe(50);
    expect(writingStreak(days, "2026-11-21")).toBe(2);
  });

  it("divides the words still needed by the days left", () => {
    expect(dailyPaceTarget(1000, 2500, new Date(2026, 10, 24), today)).toBe(500);
    expect(dailyPaceTarget(1000, null, today, today)).toBeNull();
  });
});
