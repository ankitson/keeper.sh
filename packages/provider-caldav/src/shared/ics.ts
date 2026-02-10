import { generateIcsCalendar } from "ts-ics";
import { parseIcsCalendar } from "@keeper.sh/calendar";
import type { IcsCalendar, IcsEvent, IcsRecurrenceRule, IcsAttendee, IcsOrganizer } from "ts-ics";
import type { RemoteEvent, SyncableEvent } from "@keeper.sh/provider-core";
import { isKeeperEvent } from "@keeper.sh/provider-core";

const parseGeo = (geo: string | undefined): IcsEvent["geo"] | undefined => {
  if (!geo) return undefined;
  const parts = geo.split(",");
  if (parts.length !== 2) return undefined;
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (isNaN(lat) || isNaN(lon)) return undefined;
  return { lat, lon };
};

/**
 * Transform a stored recurrence rule to the format expected by ts-ics.
 * The stored format has `until: { date: string, type: "DATE-TIME" | "DATE" }`
 * ts-ics expects `until: { date: Date, tzId?: string }`
 */
const transformRecurrenceRule = (rule: object | undefined): IcsRecurrenceRule | undefined => {
  if (!rule) return undefined;

  const r = rule as {
    frequency?: string;
    until?: { date: string; type?: string } | string;
    count?: number;
    interval?: number;
    byDay?: Array<{ day: string }> | string[];
    byMonth?: number[];
    byMonthDay?: number[];
  };

  const transformed: IcsRecurrenceRule = {
    frequency: r.frequency as IcsRecurrenceRule["frequency"],
  };

  if (r.until) {
    // Handle complex until structure: { date: "...", type: "DATE-TIME" }
    if (typeof r.until === "object" && "date" in r.until) {
      const untilDate = new Date(r.until.date);
      // If it's a DATE-TIME type, include timezone
      if (r.until.type === "DATE-TIME") {
        transformed.until = { date: untilDate, tzId: "UTC" };
      } else {
        // DATE type - no timezone needed
        transformed.until = { date: untilDate };
      }
    } else if (typeof r.until === "string") {
      // Simple string date
      transformed.until = { date: new Date(r.until), tzId: "UTC" };
    }
  }

  if (r.count !== undefined) transformed.count = r.count;
  if (r.interval !== undefined) transformed.interval = r.interval;
  if (r.byMonth !== undefined) transformed.byMonth = r.byMonth;
  if (r.byMonthDay !== undefined) transformed.byMonthDay = r.byMonthDay;

  // Transform byDay: [{ day: "MO" }] -> [{ day: "MO" }] (should work as-is)
  if (r.byDay) {
    transformed.byDay = r.byDay as IcsRecurrenceRule["byDay"];
  }

  return transformed;
};

const eventToICalString = (event: SyncableEvent, uid: string): string => {
  const icsEvent: IcsEvent = {
    uid,
    stamp: { date: new Date() },
    start: { date: event.startTime, tzId: event.startTimeZone ?? "UTC" },
    end: { date: event.endTime, tzId: event.startTimeZone ?? "UTC" },
    summary: event.summary,
    description: event.description,
    location: event.location,
    url: event.url,
    status: event.status as IcsEvent["status"],
    categories: event.categories,
    class: event.eventClass as IcsEvent["class"],
    priority: event.priority,
    comment: event.comment,
    geo: parseGeo(event.geo),
    recurrenceRule: transformRecurrenceRule(event.recurrenceRule),
    exceptionDates: event.exceptionDates as IcsEvent["exceptionDates"],
    recurrenceId: event.recurrenceId as IcsEvent["recurrenceId"],
    organizer: event.organizer as IcsOrganizer | undefined,
    attendees: event.attendees as IcsAttendee[] | undefined,
    timeTransparent: event.timeTransparent as IcsEvent["timeTransparent"],
    attach: event.attach,
  };

  const calendar: IcsCalendar = {
    events: [icsEvent],
    prodId: "-//Keeper//Keeper Calendar//EN",
    version: "2.0",
  };

  return generateIcsCalendar(calendar);
};

const parseICalToRemoteEvent = (icsString: string): RemoteEvent | null => {
  const calendar = parseIcsCalendar({ icsString });
  const [event] = calendar.events ?? [];

  if (!event?.uid || !event.start?.date || !event.end?.date) {
    return null;
  }

  return {
    deleteId: event.uid,
    endTime: new Date(event.end.date),
    isKeeperEvent: isKeeperEvent(event.uid),
    startTime: new Date(event.start.date),
    uid: event.uid,
  };
};

export { eventToICalString, parseICalToRemoteEvent };
