interface OutlookCalendarListEntry {
  id: string;
  name: string;
  color?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
  owner?: {
    name?: string;
    address?: string;
  };
}

interface OutlookCalendarListResponse {
  value: OutlookCalendarListEntry[];
  "@odata.nextLink"?: string;
}

interface OutlookEventDateTime {
  dateTime: string;
  timeZone: string;
}

interface OutlookRemovedInfo {
  reason: "deleted" | "changed";
}

interface OutlookAttendee {
  emailAddress?: {
    address?: string;
    name?: string;
  };
  status?: {
    response?: "none" | "organizer" | "tentativelyAccepted" | "accepted" | "declined" | "notResponded";
  };
  type?: "required" | "optional" | "resource";
}

interface OutlookCalendarEvent {
  id: string;
  iCalUId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: {
    contentType?: "text" | "html";
    content?: string;
  };
  location?: {
    displayName?: string;
    address?: object;
  };
  start: OutlookEventDateTime;
  end: OutlookEventDateTime;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  showAs?: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
  sensitivity?: "normal" | "personal" | "private" | "confidential";
  importance?: "low" | "normal" | "high";
  isAllDay?: boolean;
  recurrence?: {
    pattern?: {
      type?: string;
      interval?: number;
      daysOfWeek?: string[];
      firstDayOfWeek?: string;
    };
    range?: {
      type?: string;
      startDate?: string;
      endDate?: string;
      numberOfOccurrences?: number;
    };
  };
  organizer?: {
    emailAddress?: {
      address?: string;
      name?: string;
    };
  };
  attendees?: OutlookAttendee[];
  "@removed"?: OutlookRemovedInfo;
}

interface OutlookEventsListResponse {
  value: OutlookCalendarEvent[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

interface FetchEventsOptions {
  accessToken: string;
  calendarId: string;
  deltaLink?: string;
  timeMin?: Date;
  timeMax?: Date;
}

interface FetchEventsResult {
  events: OutlookCalendarEvent[];
  nextDeltaLink?: string;
  fullSyncRequired: boolean;
  isDeltaSync?: boolean;
  cancelledEventUids?: string[];
}

interface EventTimeSlot {
  uid: string;
  startTime: Date;
  endTime: Date;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  eventClass?: string;
  priority?: string;
  timeTransparent?: string;
  recurrenceRule?: object;
  organizer?: object;
  attendees?: object[];
}

export type {
  OutlookCalendarListEntry,
  OutlookCalendarListResponse,
  OutlookEventDateTime,
  OutlookCalendarEvent,
  OutlookEventsListResponse,
  OutlookAttendee,
  FetchEventsOptions,
  FetchEventsResult,
  EventTimeSlot,
};
