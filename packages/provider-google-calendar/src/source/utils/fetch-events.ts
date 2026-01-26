import type {
  FetchEventsOptions,
  FetchEventsResult,
  GoogleCalendarEvent,
  GoogleEventsListResponse,
  EventTimeSlot,
} from "../types";
import { GOOGLE_CALENDAR_EVENTS_URL, GOOGLE_CALENDAR_MAX_RESULTS, GONE_STATUS } from "../../shared/api";
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
  baseUrl: string;
  syncToken?: string;
  timeMin?: Date;
  timeMax?: Date;
  maxResults: number;
  pageToken?: string;
}

interface PageFetchResult {
  data: GoogleEventsListResponse;
  fullSyncRequired: false;
}

interface FullSyncRequiredResult {
  fullSyncRequired: true;
}

const fetchEventsPage = async (
  options: PageFetchOptions,
): Promise<PageFetchResult | FullSyncRequiredResult> => {
  const { accessToken, baseUrl, syncToken, timeMin, timeMax, maxResults, pageToken } = options;

  const url = new URL(baseUrl);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("singleEvents", "true");

  if (syncToken) {
    url.searchParams.set("syncToken", syncToken);
  } else {
    if (timeMin) {
      url.searchParams.set("timeMin", timeMin.toISOString());
    }
    if (timeMax) {
      url.searchParams.set("timeMax", timeMax.toISOString());
    }
  }

  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }

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

  const data = (await response.json()) as GoogleEventsListResponse;
  return { data, fullSyncRequired: false };
};

const fetchCalendarEvents = async (options: FetchEventsOptions): Promise<FetchEventsResult> => {
  const { accessToken, calendarId, syncToken, timeMin, timeMax, maxResults = GOOGLE_CALENDAR_MAX_RESULTS } = options;

  const baseUrl = `${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(calendarId)}/events`;
  const events: GoogleCalendarEvent[] = [];
  const cancelledEventUids: string[] = [];
  const isDeltaSync = Boolean(syncToken);

  let result = await fetchEventsPage({
    accessToken,
    baseUrl,
    maxResults,
    syncToken,
    timeMax,
    timeMin,
  });

  if (result.fullSyncRequired) {
    return { events: [], fullSyncRequired: true };
  }

  for (const event of result.data.items) {
    if (event.status === "cancelled") {
      const uid = event.iCalUID ?? event.id;
      cancelledEventUids.push(uid);
    } else {
      events.push(event);
    }
  }

  let lastSyncToken = result.data.nextSyncToken;

  while (result.data.nextPageToken) {
    result = await fetchEventsPage({
      accessToken,
      baseUrl,
      maxResults,
      pageToken: result.data.nextPageToken,
      syncToken,
      timeMax,
      timeMin,
    });

    if (result.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    for (const event of result.data.items) {
      if (event.status === "cancelled") {
        const uid = event.iCalUID ?? event.id;
        cancelledEventUids.push(uid);
      } else {
        events.push(event);
      }
    }

    if (result.data.nextSyncToken) {
      lastSyncToken = result.data.nextSyncToken;
    }
  }

  const fetchResult: FetchEventsResult = {
    events,
    fullSyncRequired: false,
    isDeltaSync,
    nextSyncToken: lastSyncToken,
  };

  if (isDeltaSync) {
    fetchResult.cancelledEventUids = cancelledEventUids;
  }

  return fetchResult;
};

interface EventTypeFilters {
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  excludeWorkingLocation: boolean;
}

const shouldExcludeEvent = (
  eventType: GoogleCalendarEvent["eventType"],
  filters: EventTypeFilters,
): boolean => {
  if (filters.excludeFocusTime && eventType === "focusTime") {
    return true;
  }
  if (filters.excludeOutOfOffice && eventType === "outOfOffice") {
    return true;
  }
  if (filters.excludeWorkingLocation && eventType === "workingLocation") {
    return true;
  }
  return false;
};

const mapGoogleVisibilityToClass = (visibility: GoogleCalendarEvent["visibility"]): string | undefined => {
  if (!visibility || visibility === "default") return undefined;
  const map: Record<string, string> = {
    public: "PUBLIC",
    private: "PRIVATE",
    confidential: "CONFIDENTIAL",
  };
  return map[visibility];
};

const mapGoogleTransparency = (transparency: GoogleCalendarEvent["transparency"]): string | undefined => {
  if (!transparency) return undefined;
  return transparency === "transparent" ? "TRANSPARENT" : "OPAQUE";
};

const parseGoogleRecurrence = (recurrence: string[] | undefined): object | undefined => {
  if (!recurrence || recurrence.length === 0) return undefined;
  // Google returns RFC5545 recurrence strings like ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]
  // We store the first RRULE as an object
  for (const rule of recurrence) {
    if (rule.startsWith("RRULE:")) {
      const rrulePart = rule.substring(6);
      const parts = rrulePart.split(";");
      const result: Record<string, unknown> = {};
      for (const part of parts) {
        const [key, value] = part.split("=");
        if (key && value) {
          if (key === "BYDAY" || key === "BYMONTH" || key === "BYMONTHDAY") {
            result[key.toLowerCase()] = value.split(",");
          } else if (key === "COUNT" || key === "INTERVAL") {
            result[key.toLowerCase()] = parseInt(value, 10);
          } else {
            result[key.toLowerCase()] = value;
          }
        }
      }
      return result;
    }
  }
  return undefined;
};

const mapGoogleOrganizer = (organizer: GoogleCalendarEvent["organizer"]): object | undefined => {
  if (!organizer) return undefined;
  return {
    email: organizer.email,
    cn: organizer.displayName,
  };
};

const mapGoogleAttendees = (attendees: GoogleCalendarEvent["attendees"]): object[] | undefined => {
  if (!attendees || attendees.length === 0) return undefined;
  return attendees.map((a) => ({
    email: a.email,
    cn: a.displayName,
    partstat: mapGoogleResponseStatus(a.responseStatus),
    role: a.optional ? "OPT-PARTICIPANT" : "REQ-PARTICIPANT",
  }));
};

const mapGoogleResponseStatus = (status: string | undefined): string => {
  if (!status) return "NEEDS-ACTION";
  const map: Record<string, string> = {
    accepted: "ACCEPTED",
    declined: "DECLINED",
    tentative: "TENTATIVE",
    needsAction: "NEEDS-ACTION",
  };
  return map[status] ?? "NEEDS-ACTION";
};

const parseGoogleEvents = (
  events: GoogleCalendarEvent[],
  filters?: EventTypeFilters,
): EventTimeSlot[] => {
  const result: EventTimeSlot[] = [];

  for (const event of events) {
    if (!event.start || !event.end || !event.iCalUID) {
      continue;
    }
    if (isKeeperEvent(event.iCalUID)) {
      continue;
    }
    if (filters && shouldExcludeEvent(event.eventType, filters)) {
      continue;
    }
    result.push({
      uid: event.iCalUID,
      startTime: parseEventDateTime(event.start),
      endTime: parseEventDateTime(event.end),
      summary: event.summary,
      description: event.description,
      location: event.location,
      status: event.status?.toUpperCase(),
      eventClass: mapGoogleVisibilityToClass(event.visibility),
      timeTransparent: mapGoogleTransparency(event.transparency),
      recurrenceRule: parseGoogleRecurrence(event.recurrence),
      organizer: mapGoogleOrganizer(event.organizer),
      attendees: mapGoogleAttendees(event.attendees),
    });
  }

  return result;
};

export { fetchCalendarEvents, parseGoogleEvents, EventsFetchError };
export type { EventTypeFilters };
