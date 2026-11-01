import { normalizeTimezone } from "../../../ics";

const unfoldIcsLines = (ics: string): string[] =>
  ics.replaceAll(/\r?\n[\t ]/g, "").split(/\r?\n/);

const readIcsPropertyValue = (lines: string[], propertyName: string): string | undefined => {
  const prefix = `${propertyName}:`;
  const line = lines.find((candidate) => candidate.toUpperCase().startsWith(prefix));
  const value = line?.slice(prefix.length).trim();
  if (!value) {
    return;
  }
  return value;
};

/*
 * CALDAV:calendar-timezone (RFC 4791 §5.2.2) is a whole VCALENDAR holding one
 * VTIMEZONE. It is the zone a CalDAV client reads the collection's floating
 * times in. Some servers (Fastmail) also stamp an X-WR-TIMEZONE on it; prefer
 * that, then the VTIMEZONE's TZID.
 */
const readCollectionTimeZone = (calendarTimeZone: unknown): string | undefined => {
  if (typeof calendarTimeZone !== "string" || calendarTimeZone.trim() === "") {
    return;
  }
  const lines = unfoldIcsLines(calendarTimeZone);
  return normalizeTimezone(
    readIcsPropertyValue(lines, "X-WR-TIMEZONE") ?? readIcsPropertyValue(lines, "TZID"),
  );
};

export { readCollectionTimeZone };
