import { describe, expect, it } from "bun:test";
import { hasActiveFutureOccurrence, rehydrateRecurrenceRule, rehydrateExceptionDates } from "./events";

describe("rehydrateRecurrenceRule", () => {
  it("converts until.date from string to Date", () => {
    const parsed = {
      frequency: "WEEKLY",
      until: { date: "2026-05-14T06:59:59.000Z" },
    };
    const rule = rehydrateRecurrenceRule(parsed);
    expect(rule.until?.date).toBeInstanceOf(Date);
    expect(rule.until?.date.toISOString()).toBe("2026-05-14T06:59:59.000Z");
  });

  it("passes through a rule without until unchanged", () => {
    const parsed = { frequency: "WEEKLY" as const, count: 26 };
    const rule = rehydrateRecurrenceRule(parsed);
    expect(rule.frequency).toBe("WEEKLY");
    expect(rule.count).toBe(26);
    expect(rule.until).toBeUndefined();
  });
});

describe("rehydrateExceptionDates", () => {
  it("converts date strings to Date objects", () => {
    const parsed = [
      { date: "2026-01-20T10:00:00.000Z" },
      { date: "2026-02-03T10:00:00.000Z" },
    ];
    const dates = rehydrateExceptionDates(parsed);
    expect(dates).toHaveLength(2);
    expect(dates[0]).toBeInstanceOf(Date);
    expect(dates[0]!.toISOString()).toBe("2026-01-20T10:00:00.000Z");
  });

  it("handles already-Date objects", () => {
    const parsed = [{ date: new Date("2026-01-20T10:00:00.000Z") }];
    const dates = rehydrateExceptionDates(parsed);
    expect(dates[0]).toBeInstanceOf(Date);
  });
});

describe("hasActiveFutureOccurrence", () => {
  it("returns true for a weekly event with future occurrences (COUNT)", () => {
    const event = {
      startTime: new Date("2026-01-13T10:00:00Z"),
      recurrenceRule: { frequency: "WEEKLY", count: 26 },
    };
    const today = new Date("2026-01-28T00:00:00Z");
    expect(hasActiveFutureOccurrence(event, today)).toBe(true);
  });

  it("returns true for a weekly event with future occurrences (UNTIL)", () => {
    const event = {
      startTime: new Date("2026-01-15T18:00:00Z"),
      recurrenceRule: {
        frequency: "WEEKLY",
        until: { date: "2026-05-14T06:59:59.000Z" },
      },
    };
    const today = new Date("2026-01-28T00:00:00Z");
    expect(hasActiveFutureOccurrence(event, today)).toBe(true);
  });

  it("returns false for an event whose recurrence has fully expired", () => {
    const event = {
      startTime: new Date("2025-01-01T10:00:00Z"),
      recurrenceRule: {
        frequency: "WEEKLY",
        count: 3,
      },
    };
    // 3 weekly occurrences from Jan 1: Jan 1, Jan 8, Jan 15 - all in 2025
    const today = new Date("2026-01-28T00:00:00Z");
    expect(hasActiveFutureOccurrence(event, today)).toBe(false);
  });

  it("returns false for an event whose UNTIL date has passed", () => {
    const event = {
      startTime: new Date("2025-01-01T10:00:00Z"),
      recurrenceRule: {
        frequency: "WEEKLY",
        until: { date: "2025-02-01T00:00:00.000Z" },
      },
    };
    const today = new Date("2026-01-28T00:00:00Z");
    expect(hasActiveFutureOccurrence(event, today)).toBe(false);
  });

  it("returns false when recurrenceRule is undefined", () => {
    const event = {
      startTime: new Date("2026-01-13T10:00:00Z"),
    };
    const today = new Date("2026-01-28T00:00:00Z");
    expect(hasActiveFutureOccurrence(event, today)).toBe(false);
  });

  it("respects exception dates when checking occurrences", () => {
    // Daily event for 3 days, but all 3 dates are exceptions
    const event = {
      startTime: new Date("2026-01-28T10:00:00Z"),
      recurrenceRule: { frequency: "DAILY", count: 3 },
      exceptionDates: [
        { date: "2026-01-28T10:00:00.000Z" },
        { date: "2026-01-29T10:00:00.000Z" },
        { date: "2026-01-30T10:00:00.000Z" },
      ],
    };
    const today = new Date("2026-01-28T00:00:00Z");
    expect(hasActiveFutureOccurrence(event, today)).toBe(false);
  });

  it("returns true for a daily recurring event with some exceptions but remaining future dates", () => {
    const event = {
      startTime: new Date("2026-01-27T10:00:00Z"),
      recurrenceRule: { frequency: "DAILY", count: 5 },
      exceptionDates: [
        { date: "2026-01-27T10:00:00.000Z" },
      ],
    };
    // Jan 27 (excepted), Jan 28, 29, 30, 31 — still has future dates
    const today = new Date("2026-01-28T00:00:00Z");
    expect(hasActiveFutureOccurrence(event, today)).toBe(true);
  });
});
