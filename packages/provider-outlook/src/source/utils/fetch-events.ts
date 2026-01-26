import type {
  FetchEventsOptions,
  FetchEventsResult,
  OutlookCalendarEvent,
  OutlookEventsListResponse,
  EventTimeSlot,
} from "../types";
import { MICROSOFT_GRAPH_API, GONE_STATUS } from "../../shared/api";
import { isSimpleAuthError } from "../../shared/errors";
import { parseEventDateTime } from "../../shared/date-time";
import { isKeeperEvent } from "@keeper.sh/provider-core";

class EventsFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly authRequired = false,
  ) {
    super(message);
    this.name = "EventsFetchError";
  }
}

interface PageFetchOptions {
  accessToken: string;
  calendarId: string;
  deltaLink?: string;
  timeMin?: Date;
  timeMax?: Date;
  nextLink?: string;
}

interface PageFetchResult {
  data: OutlookEventsListResponse;
  fullSyncRequired: false;
}

interface FullSyncRequiredResult {
  fullSyncRequired: true;
}

const buildInitialUrl = (calendarId: string, timeMin: Date, timeMax: Date): URL => {
  const encodedCalendarId = encodeURIComponent(calendarId);
  const url = new URL(`${MICROSOFT_GRAPH_API}/me/calendars/${encodedCalendarId}/calendarView/delta`);

  url.searchParams.set("startDateTime", timeMin.toISOString());
  url.searchParams.set("endDateTime", timeMax.toISOString());
  // Request more fields for full event details
  url.searchParams.set(
    "$select",
    "id,iCalUId,subject,bodyPreview,location,start,end,showAs,sensitivity,importance,recurrence,organizer,attendees",
  );

  return url;
};

const getRequestUrl = (options: PageFetchOptions): URL => {
  const { calendarId, deltaLink, timeMin, timeMax, nextLink } = options;

  if (nextLink) {
    return new URL(nextLink);
  }

  if (deltaLink) {
    return new URL(deltaLink);
  }

  if (timeMin && timeMax) {
    return buildInitialUrl(calendarId, timeMin, timeMax);
  }

  throw new Error("Either deltaLink/nextLink or timeMin/timeMax is required");
};

const fetchEventsPage = async (
  options: PageFetchOptions,
): Promise<PageFetchResult | FullSyncRequiredResult> => {
  const { accessToken } = options;
  const url = getRequestUrl(options);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === GONE_STATUS) {
    return { fullSyncRequired: true };
  }

  if (!response.ok) {
    const authRequired = isSimpleAuthError(response.status);
    throw new EventsFetchError(
      `Failed to fetch events: ${response.status}`,
      response.status,
      authRequired,
    );
  }

  const data = (await response.json()) as OutlookEventsListResponse;
  return { data, fullSyncRequired: false };
};

const fetchCalendarEvents = async (options: FetchEventsOptions): Promise<FetchEventsResult> => {
  const { accessToken, calendarId, deltaLink, timeMin, timeMax } = options;

  const events: OutlookCalendarEvent[] = [];
  const cancelledEventUids: string[] = [];
  const isDeltaSync = Boolean(deltaLink);

  const initialResult = await fetchEventsPage({
    accessToken,
    calendarId,
    deltaLink,
    timeMax,
    timeMin,
  });

  if (initialResult.fullSyncRequired) {
    return { events: [], fullSyncRequired: true };
  }

  for (const event of initialResult.data.value) {
    if (event["@removed"]) {
      const uid = event.iCalUId ?? event.id;
      cancelledEventUids.push(uid);
    } else {
      events.push(event);
    }
  }

  let lastDeltaLink = initialResult.data["@odata.deltaLink"];
  let nextLink = initialResult.data["@odata.nextLink"];

  while (nextLink) {
    const pageResult = await fetchEventsPage({
      accessToken,
      calendarId,
      nextLink,
      timeMax,
      timeMin,
    });

    if (pageResult.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    for (const event of pageResult.data.value) {
      if (event["@removed"]) {
        const uid = event.iCalUId ?? event.id;
        cancelledEventUids.push(uid);
      } else {
        events.push(event);
      }
    }

    if (pageResult.data["@odata.deltaLink"]) {
      lastDeltaLink = pageResult.data["@odata.deltaLink"];
    }
    nextLink = pageResult.data["@odata.nextLink"];
  }

  const result: FetchEventsResult = {
    events,
    fullSyncRequired: false,
    isDeltaSync,
    nextDeltaLink: lastDeltaLink,
  };

  if (isDeltaSync) {
    result.cancelledEventUids = cancelledEventUids;
  }

  return result;
};

const mapOutlookSensitivityToClass = (sensitivity: OutlookCalendarEvent["sensitivity"]): string | undefined => {
  if (!sensitivity || sensitivity === "normal") return undefined;
  const map: Record<string, string> = {
    personal: "PRIVATE",
    private: "PRIVATE",
    confidential: "CONFIDENTIAL",
  };
  return map[sensitivity];
};

const mapOutlookShowAsToTransparency = (showAs: OutlookCalendarEvent["showAs"]): string | undefined => {
  if (!showAs) return undefined;
  return showAs === "free" ? "TRANSPARENT" : "OPAQUE";
};

const mapOutlookImportanceToPriority = (importance: OutlookCalendarEvent["importance"]): string | undefined => {
  if (!importance) return undefined;
  const map: Record<string, string> = {
    low: "9",
    normal: "5",
    high: "1",
  };
  return map[importance];
};

const parseOutlookRecurrence = (recurrence: OutlookCalendarEvent["recurrence"]): object | undefined => {
  if (!recurrence || !recurrence.pattern) return undefined;
  const result: Record<string, unknown> = {};

  // Map type to freq
  if (recurrence.pattern.type) {
    const typeMap: Record<string, string> = {
      daily: "DAILY",
      weekly: "WEEKLY",
      absoluteMonthly: "MONTHLY",
      relativeMonthly: "MONTHLY",
      absoluteYearly: "YEARLY",
      relativeYearly: "YEARLY",
    };
    result.freq = typeMap[recurrence.pattern.type] ?? recurrence.pattern.type.toUpperCase();
  }

  if (recurrence.pattern.interval) {
    result.interval = recurrence.pattern.interval;
  }

  if (recurrence.pattern.daysOfWeek && recurrence.pattern.daysOfWeek.length > 0) {
    const dayMap: Record<string, string> = {
      sunday: "SU",
      monday: "MO",
      tuesday: "TU",
      wednesday: "WE",
      thursday: "TH",
      friday: "FR",
      saturday: "SA",
    };
    result.byday = recurrence.pattern.daysOfWeek.map((day) => dayMap[day.toLowerCase()] ?? day.toUpperCase());
  }

  if (recurrence.range) {
    if (recurrence.range.numberOfOccurrences) {
      result.count = recurrence.range.numberOfOccurrences;
    }
    if (recurrence.range.endDate) {
      result.until = recurrence.range.endDate;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

const mapOutlookOrganizer = (organizer: OutlookCalendarEvent["organizer"]): object | undefined => {
  if (!organizer?.emailAddress) return undefined;
  return {
    email: organizer.emailAddress.address,
    cn: organizer.emailAddress.name,
  };
};

const mapOutlookAttendees = (attendees: OutlookCalendarEvent["attendees"]): object[] | undefined => {
  if (!attendees || attendees.length === 0) return undefined;
  return attendees.map((a) => ({
    email: a.emailAddress?.address,
    cn: a.emailAddress?.name,
    partstat: mapOutlookResponseStatus(a.status?.response),
    role: a.type === "optional" ? "OPT-PARTICIPANT" : "REQ-PARTICIPANT",
  }));
};

const mapOutlookResponseStatus = (status: string | undefined): string => {
  if (!status) return "NEEDS-ACTION";
  const map: Record<string, string> = {
    accepted: "ACCEPTED",
    declined: "DECLINED",
    tentativelyAccepted: "TENTATIVE",
    none: "NEEDS-ACTION",
    notResponded: "NEEDS-ACTION",
    organizer: "ACCEPTED",
  };
  return map[status] ?? "NEEDS-ACTION";
};

const parseOutlookEvents = (events: OutlookCalendarEvent[]): EventTimeSlot[] => {
  const result: EventTimeSlot[] = [];

  for (const event of events) {
    if (!event.start || !event.end || !event.iCalUId) {
      continue;
    }
    if (isKeeperEvent(event.iCalUId)) {
      continue;
    }
    result.push({
      uid: event.iCalUId,
      startTime: parseEventDateTime(event.start),
      endTime: parseEventDateTime(event.end),
      summary: event.subject,
      description: event.bodyPreview,
      location: event.location?.displayName,
      eventClass: mapOutlookSensitivityToClass(event.sensitivity),
      priority: mapOutlookImportanceToPriority(event.importance),
      timeTransparent: mapOutlookShowAsToTransparency(event.showAs),
      recurrenceRule: parseOutlookRecurrence(event.recurrence),
      organizer: mapOutlookOrganizer(event.organizer),
      attendees: mapOutlookAttendees(event.attendees),
    });
  }

  return result;
};

export { fetchCalendarEvents, parseOutlookEvents, EventsFetchError };
