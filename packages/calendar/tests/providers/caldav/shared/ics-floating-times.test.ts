import { describe, expect, it } from "vitest";
import { parseICalCalendarsToRemoteEvents } from "../../../../src/providers/caldav/shared/ics";

const NO_ZONE_REASON = "Floating ICS DTEND requires an explicit TZID or X-WR-TIMEZONE";

const zonedResource = (uid: string): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//Test//EN",
  "BEGIN:VEVENT",
  `UID:${uid}`,
  "DTSTART:20261001T090000Z",
  "DTEND:20261001T100000Z",
  `SUMMARY:${uid}`,
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

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

  it("withholds a zoneless floating event by UID and keeps the rest of the collection", () => {
    const result = parseICalCalendarsToRemoteEvents([
      zonedResource("before"),
      floatingResource({ uid: "floating@example.com" }),
      zonedResource("after"),
    ]);

    expect(result.skippedResourceCount).toBe(0);
    expect(result.unsupportedEvents).toEqual([
      { reason: NO_ZONE_REASON, uid: "floating@example.com" },
    ]);
    // Still present, so ingestion's removal diff keeps whatever state it already has.
    expect(result.events.map(({ uid }) => uid).toSorted())
      .toEqual(["after", "before", "floating@example.com"]);
  });

  it("still skips the resource when the zoneless event has no UID to withhold it by", () => {
    const result = parseICalCalendarsToRemoteEvents([
      zonedResource("before"),
      floatingResource(),
    ]);

    expect(result.skippedResourceCount).toBe(1);
    expect(result.skippedResourceReasons).toEqual([NO_ZONE_REASON]);
    expect(result.events.map(({ uid }) => uid)).toEqual(["before"]);
  });
});
