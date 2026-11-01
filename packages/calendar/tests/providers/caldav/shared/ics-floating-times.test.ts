import { describe, expect, it } from "vitest";
import { parseICalCalendarsToRemoteEvents } from "../../../../src/providers/caldav/shared/ics";

const uidLines = (uid: string | undefined): string[] => {
  if (!uid) {
    return [];
  }
  return [`UID:${uid}`];
};

// Shape of an invite imported as-is by macOS Calendar: DTEND first, no zone anywhere.
const floatingResource = (lines: { uid?: string; calendarLines?: string[] } = {}): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Apple Inc.//macOS 26.6.2//EN",
  ...lines.calendarLines ?? [],
  "BEGIN:VEVENT",
  "DTEND:20261003T190000",
  ...uidLines(lines.uid),
  "DTSTAMP:20260927T011807Z",
  "SUMMARY:Floating meetup",
  "DTSTART:20261003T170000",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseICalCalendarsToRemoteEvents floating times", () => {
  it("reads floating times in the collection's published zone", () => {
    const result = parseICalCalendarsToRemoteEvents(
      [floatingResource({ uid: "floating@example.com" })],
      { calendarTimeZone: "America/Vancouver" },
    );

    expect(result.skippedResourceCount).toBe(0);
    expect(result.unsupportedEvents).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.startTime.toISOString()).toBe("2026-10-04T00:00:00.000Z");
    expect(result.events[0]?.endTime.toISOString()).toBe("2026-10-04T02:00:00.000Z");
  });

  it("prefers the resource's own X-WR-TIMEZONE over the collection's", () => {
    const result = parseICalCalendarsToRemoteEvents(
      [floatingResource({
        calendarLines: ["X-WR-TIMEZONE:Europe/London"],
        uid: "floating@example.com",
      })],
      { calendarTimeZone: "America/Vancouver" },
    );

    expect(result.events[0]?.startTime.toISOString()).toBe("2026-10-03T16:00:00.000Z");
  });
});
