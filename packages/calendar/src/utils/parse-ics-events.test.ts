import { describe, expect, it } from "bun:test";
import { parseIcsEvents } from "./parse-ics-events";
import { parseIcsCalendar } from "./parse-ics-calendar";
import { hasActiveFutureOccurrence } from "@keeper.sh/provider-core";

const makeRecurringEventIcs = (opts: {
  uid: string;
  summary: string;
  dtstart: string;
  dtend: string;
  rrule: string;
}): string => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:${opts.uid}
DTSTART:${opts.dtstart}
DTEND:${opts.dtend}
SUMMARY:${opts.summary}
RRULE:${opts.rrule}
END:VEVENT
END:VCALENDAR`;

describe("recurring event sync bug", () => {
  it("parseIcsEvents stores recurring event as single master event with original start date", () => {
    const ics = makeRecurringEventIcs({
      uid: "weekly-lecture@example.com",
      summary: "Weekly Lecture",
      dtstart: "20260113T100000Z",
      dtend: "20260113T110000Z",
      rrule: "FREQ=WEEKLY;COUNT=26",
    });

    const calendar = parseIcsCalendar({ icsString: ics });
    const events = parseIcsEvents(calendar);

    // Parser produces exactly ONE event (the master), not 26 occurrences
    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toBe("Weekly Lecture");
    expect(events[0]!.recurrenceRule).toBeDefined();

    // The startTime is the FIRST occurrence: Jan 13, 2026
    const startTime = events[0]!.startTime;
    expect(startTime.getUTCFullYear()).toBe(2026);
    expect(startTime.getUTCMonth()).toBe(0); // January
    expect(startTime.getUTCDate()).toBe(13);
  });

  it("FIXED: recurring event with past start date is included via hasActiveFutureOccurrence", () => {
    const ics = makeRecurringEventIcs({
      uid: "weekly-lecture@example.com",
      summary: "Weekly Lecture",
      dtstart: "20260113T100000Z",
      dtend: "20260113T110000Z",
      rrule: "FREQ=WEEKLY;COUNT=26",
    });

    const calendar = parseIcsCalendar({ icsString: ics });
    const events = parseIcsEvents(calendar);

    const simulatedToday = new Date("2026-01-28T00:00:00Z");

    // The SQL query now also fetches events with a recurrenceRule.
    // For events with startTime < today that have a recurrenceRule,
    // hasActiveFutureOccurrence checks if any future occurrence exists.
    const event = events[0]!;
    const included =
      event.startTime >= simulatedToday ||
      hasActiveFutureOccurrence(
        {
          startTime: event.startTime,
          recurrenceRule: event.recurrenceRule,
          exceptionDates: event.exceptionDates,
        },
        simulatedToday,
      );

    expect(included).toBe(true);
  });

  it("non-recurring past event is correctly excluded (expected behavior)", () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:one-off-past@example.com
DTSTART:20260110T100000Z
DTEND:20260110T110000Z
SUMMARY:One-off Past Event
END:VEVENT
END:VCALENDAR`;

    const calendar = parseIcsCalendar({ icsString: ics });
    const events = parseIcsEvents(calendar);

    const simulatedToday = new Date("2026-01-28T00:00:00Z");
    const filteredEvents = events.filter(
      (event) => event.startTime >= simulatedToday,
    );

    // Correctly excluded - this is a non-recurring past event
    expect(filteredEvents).toHaveLength(0);
  });

  it("future non-recurring event is correctly included", () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:future-event@example.com
DTSTART:20260201T100000Z
DTEND:20260201T110000Z
SUMMARY:Future Event
END:VEVENT
END:VCALENDAR`;

    const calendar = parseIcsCalendar({ icsString: ics });
    const events = parseIcsEvents(calendar);

    const simulatedToday = new Date("2026-01-28T00:00:00Z");
    const filteredEvents = events.filter(
      (event) => event.startTime >= simulatedToday,
    );

    // Correctly included - future event
    expect(filteredEvents).toHaveLength(1);
  });

  it("FIXED: recurring event with UNTIL date far in the future is included", () => {
    const ics = makeRecurringEventIcs({
      uid: "weekly-recitation@example.com",
      summary: "Weekly Recitation",
      dtstart: "20260115T180000Z",
      dtend: "20260115T190000Z",
      rrule: "FREQ=WEEKLY;UNTIL=20260514T065959Z",
    });

    const calendar = parseIcsCalendar({ icsString: ics });
    const events = parseIcsEvents(calendar);

    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toBe("Weekly Recitation");

    const simulatedToday = new Date("2026-01-28T00:00:00Z");
    const event = events[0]!;

    const included =
      event.startTime >= simulatedToday ||
      hasActiveFutureOccurrence(
        {
          startTime: event.startTime,
          recurrenceRule: event.recurrenceRule,
          exceptionDates: event.exceptionDates,
        },
        simulatedToday,
      );

    // Now correctly included — has weekly occurrences until May 2026
    expect(included).toBe(true);
  });

  it("preserves startTimeZone from DTSTART TZID for recurring events", () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VTIMEZONE
TZID:America/Los_Angeles
BEGIN:STANDARD
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
TZNAME:PST
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
TZNAME:PDT
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:timezone-test@example.com
DTSTART;TZID=America/Los_Angeles:20260112T180000
DTEND;TZID=America/Los_Angeles:20260112T200000
SUMMARY:HTGAA Victoria Node Meeting
RRULE:FREQ=WEEKLY;BYDAY=MO,WE
END:VEVENT
END:VCALENDAR`;

    const calendar = parseIcsCalendar({ icsString: ics });
    const events = parseIcsEvents(calendar);

    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toBe("HTGAA Victoria Node Meeting");
    expect(events[0]!.startTimeZone).toBe("America/Los_Angeles");
    expect(events[0]!.recurrenceRule).toBeDefined();
  });

  it("startTimeZone is undefined for UTC events", () => {
    const ics = makeRecurringEventIcs({
      uid: "utc-event@example.com",
      summary: "UTC Event",
      dtstart: "20260113T100000Z",
      dtend: "20260113T110000Z",
      rrule: "FREQ=WEEKLY;COUNT=26",
    });

    const calendar = parseIcsCalendar({ icsString: ics });
    const events = parseIcsEvents(calendar);

    expect(events).toHaveLength(1);
    // UTC events (Z suffix) should not have a specific tzId
    expect(events[0]!.startTimeZone).toBeUndefined();
  });

  it("fully expired recurring event is correctly excluded", () => {
    const ics = makeRecurringEventIcs({
      uid: "expired-event@example.com",
      summary: "Expired Weekly",
      dtstart: "20250101T100000Z",
      dtend: "20250101T110000Z",
      rrule: "FREQ=WEEKLY;COUNT=3",
    });

    const calendar = parseIcsCalendar({ icsString: ics });
    const events = parseIcsEvents(calendar);

    const simulatedToday = new Date("2026-01-28T00:00:00Z");
    const event = events[0]!;

    // 3 weekly occurrences from Jan 1 2025: Jan 1, Jan 8, Jan 15 - all in 2025
    const included =
      event.startTime >= simulatedToday ||
      hasActiveFutureOccurrence(
        {
          startTime: event.startTime,
          recurrenceRule: event.recurrenceRule,
          exceptionDates: event.exceptionDates,
        },
        simulatedToday,
      );

    expect(included).toBe(false);
  });
});
