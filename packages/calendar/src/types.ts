interface EventTimeSlot {
  uid: string;
  startTime: Date;
  endTime: Date;
  // Tier 1 - Core Content
  summary?: string;
  description?: string;
  location?: string;
  url?: string;
  status?: string;
  categories?: string[];
  class?: string;
  priority?: string;
  comment?: string;
  geo?: string;
  // Tier 2 - Recurrence (stored as JSON in DB)
  recurrenceRule?: object;
  exceptionDates?: object;
  recurrenceId?: object;
  // Tier 3 - People (stored as JSON in DB)
  organizer?: object;
  attendees?: object[];
  // Other
  timeTransparent?: string;
  attach?: string;
}

type StoredEventTimeSlot = EventTimeSlot & {
  id: string;
};

interface EventDiff {
  toAdd: EventTimeSlot[];
  toRemove: StoredEventTimeSlot[];
}

interface SerializedIcsCalendar {
  version: string;
  events?: {
    uid?: string;
    start: { date: string };
    end?: { date: string };
    duration?: {
      weeks?: number;
      days?: number;
      hours?: number;
      minutes?: number;
      seconds?: number;
    };
  }[];
}

export type { EventTimeSlot, StoredEventTimeSlot, EventDiff, SerializedIcsCalendar };
