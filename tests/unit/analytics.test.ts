import { describe, expect, it } from "vitest";
import { analyticsWindow, completedDaysWindow } from "../../src/core/analytics/historicalAnalytics";

describe("historical analytics windows", () => {
  const now = new Date("2026-07-16T12:00:00.000Z");

  it("uses restaurant midnight converted to UTC", () => {
    expect(analyticsWindow("today", "Africa/Nairobi", "", "", now)).toMatchObject({
      rangeStart: "2026-07-15T21:00:00.000Z", rangeEnd: "2026-07-16T21:00:00.000Z",
    });
  });

  it("makes custom end dates inclusive through an exclusive next midnight", () => {
    const range = analyticsWindow("custom", "Africa/Nairobi", "2026-07-01", "2026-07-03", now);
    expect(range.rangeStart).toBe("2026-06-30T21:00:00.000Z");
    expect(range.rangeEnd).toBe("2026-07-03T21:00:00.000Z");
  });

  it("handles DST 23-hour and 25-hour days", () => {
    const spring = analyticsWindow("custom", "America/New_York", "2026-03-08", "2026-03-08", now);
    const fall = analyticsWindow("custom", "America/New_York", "2026-11-01", "2026-11-01", now);
    expect(new Date(spring.rangeEnd).getTime() - new Date(spring.rangeStart).getTime()).toBe(23 * 3_600_000);
    expect(new Date(fall.rangeEnd).getTime() - new Date(fall.rangeStart).getTime()).toBe(25 * 3_600_000);
  });

  it("keeps cross-midnight events in their own canonical periods", () => {
    const monday = analyticsWindow("custom", "Africa/Nairobi", "2026-07-13", "2026-07-13", now);
    const tuesday = analyticsWindow("custom", "Africa/Nairobi", "2026-07-14", "2026-07-14", now);
    const createdAt = new Date("2026-07-13T20:55:00.000Z").getTime();
    const paidAt = new Date("2026-07-13T21:10:00.000Z").getTime();
    const inside = (time: number, range: typeof monday) => time >= Date.parse(range.rangeStart) && time < Date.parse(range.rangeEnd);
    expect(inside(createdAt, monday)).toBe(true);
    expect(inside(paidAt, monday)).toBe(false);
    expect(inside(paidAt, tuesday)).toBe(true);
  });

  it("builds completed-day history by calendar boundaries", () => {
    const range = completedDaysWindow(7, "Africa/Nairobi", now);
    expect((Date.parse(range.rangeEnd) - Date.parse(range.rangeStart)) / 86_400_000).toBe(7);
  });
});
