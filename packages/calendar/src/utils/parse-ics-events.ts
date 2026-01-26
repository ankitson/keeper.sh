import type { IcsCalendar, IcsDuration, IcsEvent } from "ts-ics";
import type { EventTimeSlot } from "../types";
import {
  KEEPER_EVENT_SUFFIX,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  MS_PER_WEEK,
} from "@keeper.sh/constants";

const DEFAULT_DURATION_VALUE = 0;

const durationToMs = (duration: IcsDuration): number => {
  const {
    weeks = DEFAULT_DURATION_VALUE,
    days = DEFAULT_DURATION_VALUE,
    hours = DEFAULT_DURATION_VALUE,
    minutes = DEFAULT_DURATION_VALUE,
    seconds = DEFAULT_DURATION_VALUE,
  } = duration;
  return (
    weeks * MS_PER_WEEK +
    days * MS_PER_DAY +
    hours * MS_PER_HOUR +
    minutes * MS_PER_MINUTE +
    seconds * MS_PER_SECOND
  );
};

const getEventEndTime = (event: IcsEvent, startTime: Date): Date => {
  if ("end" in event && event.end) {
    return event.end.date;
  }

  if ("duration" in event && event.duration) {
    return new Date(startTime.getTime() + durationToMs(event.duration));
  }

  return startTime;
};

const isKeeperEvent = (uid: string | undefined): boolean =>
  uid?.endsWith(KEEPER_EVENT_SUFFIX) ?? false;

const formatGeo = (geo: IcsEvent["geo"]): string | undefined => {
  if (!geo) return undefined;
  return `${geo.lat},${geo.lon}`;
};

const parseIcsEvents = (calendar: IcsCalendar): EventTimeSlot[] => {
  const result: EventTimeSlot[] = [];

  for (const event of calendar.events ?? []) {
    if (isKeeperEvent(event.uid)) {
      continue;
    }
    if (!event.uid) {
      continue;
    }

    const startTime = event.start.date;
    result.push({
      uid: event.uid,
      startTime,
      endTime: getEventEndTime(event, startTime),
      // Tier 1 - Core Content
      summary: event.summary,
      description: event.description,
      location: event.location,
      url: event.url,
      status: event.status,
      categories: event.categories,
      class: event.class,
      priority: event.priority,
      comment: event.comment,
      geo: formatGeo(event.geo),
      // Tier 2 - Recurrence
      recurrenceRule: event.recurrenceRule,
      exceptionDates: event.exceptionDates,
      recurrenceId: event.recurrenceId,
      // Tier 3 - People
      organizer: event.organizer,
      attendees: event.attendees,
      // Other
      timeTransparent: event.timeTransparent,
      attach: event.attach,
    });
  }

  return result;
};

export { parseIcsEvents };
