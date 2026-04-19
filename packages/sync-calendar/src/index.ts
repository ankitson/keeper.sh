import type { calendarSourcesTable } from "@keeper.sh/database/schema";
import { calendarSnapshotsTable, eventStatesTable } from "@keeper.sh/database/schema";
import { pullRemoteCalendar } from "@keeper.sh/pull-calendar";
import { diffEvents, parseIcsEvents } from "@keeper.sh/sync-events";
import { parseIcsCalendar } from "@keeper.sh/calendar";
import { desc, eq, inArray } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const FIRST_RESULT_LIMIT = 1;
const EMPTY_EVENTS_COUNT = 0;

class RemoteCalendarSyncError extends Error {
  constructor(
    public sourceId: string,
    cause: unknown,
  ) {
    super(`Failed to sync remote calendar ${sourceId}`);
    this.cause = cause;
  }
}

type Source = typeof calendarSourcesTable.$inferSelect;

interface SyncCalendarService {
  createSnapshot: (sourceId: string, ical: string) => Promise<void>;
  syncSourceFromSnapshot: (source: Source) => Promise<void>;
  fetchAndSyncSource: (source: Source) => Promise<void>;
}

const safeJsonParse = (value: string | null): object | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as object;
  } catch {
    return undefined;
  }
};

const toStoredEvent = (row: {
  id: string;
  sourceEventUid: string;
  startTime: Date;
  endTime: Date;
  startTimeZone: string | null;
  recurrenceRule: string | null;
  exceptionDates: string | null;
}): { endTime: Date; exceptionDates?: object; id: string; recurrenceRule?: object; startTime: Date; startTimeZone?: string; uid: string } => {
  const event = {
    endTime: row.endTime,
    id: row.id,
    startTime: row.startTime,
    uid: row.sourceEventUid,
  };

  return {
    ...event,
    ...(row.startTimeZone !== null && { startTimeZone: row.startTimeZone }),
    ...(row.recurrenceRule !== null && { recurrenceRule: safeJsonParse(row.recurrenceRule) }),
    ...(row.exceptionDates !== null && { exceptionDates: safeJsonParse(row.exceptionDates) }),
  };
};

const createSyncCalendarService = (database: BunSQLDatabase): SyncCalendarService => {
  const getLatestSnapshot = async (
    sourceId: string,
  ): Promise<ReturnType<typeof parseIcsCalendar> | null> => {
    const [snapshot] = await database
      .select({ ical: calendarSnapshotsTable.ical })
      .from(calendarSnapshotsTable)
      .where(eq(calendarSnapshotsTable.sourceId, sourceId))
      .orderBy(desc(calendarSnapshotsTable.createdAt))
      .limit(FIRST_RESULT_LIMIT);

    if (!snapshot?.ical) {
      return null;
    }
    return parseIcsCalendar({ icsString: snapshot.ical });
  };

  const getStoredEvents = async (
    sourceId: string,
  ): Promise<{ endTime: Date; exceptionDates?: object; id: string; recurrenceRule?: object; startTime: Date; startTimeZone?: string; uid: string }[]> => {
    const results = await database
      .select({
        endTime: eventStatesTable.endTime,
        exceptionDates: eventStatesTable.exceptionDates,
        id: eventStatesTable.id,
        recurrenceRule: eventStatesTable.recurrenceRule,
        sourceEventUid: eventStatesTable.sourceEventUid,
        startTime: eventStatesTable.startTime,
        startTimeZone: eventStatesTable.startTimeZone,
      })
      .from(eventStatesTable)
      .where(eq(eventStatesTable.sourceId, sourceId));

    const events = [];
    for (const row of results) {
      if (row.sourceEventUid === null) {
        continue;
      }
      events.push(toStoredEvent({ ...row, sourceEventUid: row.sourceEventUid }));
    }

    return events;
  };

  const removeEvents = async (_sourceId: string, eventIds: string[]): Promise<void> => {
    await database.delete(eventStatesTable).where(inArray(eventStatesTable.id, eventIds));
  };

  const addEvents = async (
    sourceId: string,
    events: import("@keeper.sh/calendar").EventTimeSlot[],
  ): Promise<void> => {
    const rows = events.map((event) => ({
      endTime: event.endTime,
      sourceEventUid: event.uid,
      sourceId,
      startTime: event.startTime,
      startTimeZone: event.startTimeZone,
      // Tier 1 - Core Content
      summary: event.summary,
      description: event.description,
      location: event.location,
      url: event.url,
      status: event.status,
      categories: event.categories ? JSON.stringify(event.categories) : null,
      eventClass: event.class,
      priority: event.priority,
      comment: event.comment,
      geo: event.geo,
      // Tier 2 - Recurrence (JSON)
      recurrenceRule: event.recurrenceRule ? JSON.stringify(event.recurrenceRule) : null,
      exceptionDates: event.exceptionDates ? JSON.stringify(event.exceptionDates) : null,
      recurrenceId: event.recurrenceId ? JSON.stringify(event.recurrenceId) : null,
      // Tier 3 - People (JSON)
      organizer: event.organizer ? JSON.stringify(event.organizer) : null,
      attendees: event.attendees ? JSON.stringify(event.attendees) : null,
      // Other
      timeTransparent: event.timeTransparent,
      attach: event.attach,
    }));

    await database.insert(eventStatesTable).values(rows);
  };

  const createSnapshot = async (sourceId: string, ical: string): Promise<void> => {
    await database.insert(calendarSnapshotsTable).values({ ical, sourceId });
  };

  const syncSourceFromSnapshot = async (source: Source): Promise<void> => {
    const icsCalendar = await getLatestSnapshot(source.id);
    if (!icsCalendar) {
      return;
    }

    const remoteEvents = parseIcsEvents(icsCalendar);
    const storedEvents = await getStoredEvents(source.id);
    const { toAdd, toRemove } = diffEvents(remoteEvents, storedEvents);

    if (toRemove.length > EMPTY_EVENTS_COUNT) {
      const eventIds = toRemove.map((event) => event.id);
      await removeEvents(source.id, eventIds);
    }

    if (toAdd.length > EMPTY_EVENTS_COUNT) {
      await addEvents(source.id, toAdd);
    }
  };

  const fetchAndSyncSource = async (source: Source): Promise<void> => {
    if (!source.url) {
      throw new Error(`Source ${source.id} is missing url`);
    }
    const { ical } = await pullRemoteCalendar("ical", source.url);
    await createSnapshot(source.id, ical);
    await syncSourceFromSnapshot(source);
  };

  return { createSnapshot, fetchAndSyncSource, syncSourceFromSnapshot };
};

export { RemoteCalendarSyncError, createSyncCalendarService };
export type { Source, SyncCalendarService };
