interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
  backgroundColor?: string;
  foregroundColor?: string;
}

interface GoogleCalendarListResponse {
  kind: "calendar#calendarList";
  items: GoogleCalendarListEntry[];
  nextPageToken?: string;
}

interface GoogleEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  optional?: boolean;
  organizer?: boolean;
}

interface GoogleCalendarEvent {
  id: string;
  iCalUID?: string;
  status: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
  created?: string;
  updated?: string;
  eventType?: "default" | "focusTime" | "workingLocation" | "outOfOffice";
  visibility?: "default" | "public" | "private" | "confidential";
  transparency?: "opaque" | "transparent";
  recurrence?: string[];
  recurringEventId?: string;
  attendees?: GoogleAttendee[];
  organizer?: {
    email?: string;
    displayName?: string;
    self?: boolean;
  };
}

interface GoogleEventsListResponse {
  kind: "calendar#events";
  items: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface FetchEventsOptions {
  accessToken: string;
  calendarId: string;
  syncToken?: string;
  timeMin?: Date;
  timeMax?: Date;
  maxResults?: number;
}

interface FetchEventsResult {
  events: GoogleCalendarEvent[];
  nextSyncToken?: string;
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
  timeTransparent?: string;
  recurrenceRule?: object;
  organizer?: object;
  attendees?: object[];
}

export type {
  GoogleCalendarListEntry,
  GoogleCalendarListResponse,
  GoogleEventDateTime,
  GoogleCalendarEvent,
  GoogleEventsListResponse,
  GoogleAttendee,
  FetchEventsOptions,
  FetchEventsResult,
  EventTimeSlot,
};
