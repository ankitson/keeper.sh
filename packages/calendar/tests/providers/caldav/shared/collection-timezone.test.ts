import { describe, expect, it } from "vitest";
import { readCollectionTimeZone } from "../../../../src/providers/caldav/shared/collection-timezone";

const calendarTimeZone = (lines: string[]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//Test//EN",
  ...lines,
  "BEGIN:VTIMEZONE",
  "TZID:America/Vancouver",
  "BEGIN:STANDARD",
  "DTSTART:19701101T020000",
  "TZOFFSETFROM:-0700",
  "TZOFFSETTO:-0800",
  "END:STANDARD",
  "END:VTIMEZONE",
  "END:VCALENDAR",
].join("\r\n");

describe("readCollectionTimeZone", () => {
  it("reads the VTIMEZONE's TZID", () => {
    expect(readCollectionTimeZone(calendarTimeZone([]))).toBe("America/Vancouver");
  });

  it("prefers an X-WR-TIMEZONE stamped on the property", () => {
    expect(readCollectionTimeZone(calendarTimeZone(["X-WR-TIMEZONE:Europe/London"])))
      .toBe("Europe/London");
  });

  it("maps a Windows zone name to IANA", () => {
    expect(readCollectionTimeZone([
      "BEGIN:VCALENDAR",
      "BEGIN:VTIMEZONE",
      "TZID:Pacific Standard Time",
      "END:VTIMEZONE",
      "END:VCALENDAR",
    ].join("\n"))).toBe("America/Los_Angeles");
  });

  it.each(["", "   ", 42, null])("returns nothing for %p", (value) => {
    expect(readCollectionTimeZone(value)).toBeUndefined();
  });
});
