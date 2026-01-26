import {
  calendarSourcesTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { getStartOfToday } from "@keeper.sh/date-utils";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SyncableEvent } from "../types";

const EMPTY_SOURCES_COUNT = 0;

const getMappedSourceIds = async (
  database: BunSQLDatabase,
  destinationId: string,
): Promise<string[]> => {
  const mappings = await database
    .select({ sourceId: sourceDestinationMappingsTable.sourceId })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationId, destinationId));

  return mappings.map((mapping) => mapping.sourceId);
};

const safeJsonParse = <T>(value: string | null): T | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

const fetchEventsForSources = async (
  database: BunSQLDatabase,
  sourceIds: string[],
): Promise<SyncableEvent[]> => {
  if (sourceIds.length === EMPTY_SOURCES_COUNT) {
    return [];
  }

  const startOfToday = getStartOfToday();

  const results = await database
    .select({
      endTime: eventStatesTable.endTime,
      id: eventStatesTable.id,
      sourceEventUid: eventStatesTable.sourceEventUid,
      sourceId: eventStatesTable.sourceId,
      sourceName: calendarSourcesTable.name,
      sourceType: calendarSourcesTable.sourceType,
      sourceUrl: calendarSourcesTable.url,
      startTime: eventStatesTable.startTime,
      // Tier 1 - Core Content
      summary: eventStatesTable.summary,
      description: eventStatesTable.description,
      location: eventStatesTable.location,
      url: eventStatesTable.url,
      status: eventStatesTable.status,
      categories: eventStatesTable.categories,
      eventClass: eventStatesTable.eventClass,
      priority: eventStatesTable.priority,
      comment: eventStatesTable.comment,
      geo: eventStatesTable.geo,
      // Tier 2 - Recurrence (JSON)
      recurrenceRule: eventStatesTable.recurrenceRule,
      exceptionDates: eventStatesTable.exceptionDates,
      recurrenceId: eventStatesTable.recurrenceId,
      // Tier 3 - People (JSON)
      organizer: eventStatesTable.organizer,
      attendees: eventStatesTable.attendees,
      // Other
      timeTransparent: eventStatesTable.timeTransparent,
      attach: eventStatesTable.attach,
    })
    .from(eventStatesTable)
    .innerJoin(calendarSourcesTable, eq(eventStatesTable.sourceId, calendarSourcesTable.id))
    .where(
      and(
        inArray(eventStatesTable.sourceId, sourceIds),
        gte(eventStatesTable.startTime, startOfToday),
      ),
    )
    .orderBy(asc(eventStatesTable.startTime));

  const syncableEvents: SyncableEvent[] = [];

  for (const result of results) {
    if (result.sourceEventUid === null) {
      continue;
    }

    syncableEvents.push({
      endTime: result.endTime,
      id: result.id,
      sourceEventUid: result.sourceEventUid,
      sourceId: result.sourceId,
      sourceName: result.sourceName,
      sourceUrl: result.sourceUrl ?? result.sourceType,
      startTime: result.startTime,
      // Fallback: summary from event, then source name, then "Busy"
      summary: result.summary ?? result.sourceName ?? "Busy",
      // Tier 1 - Core Content
      description: result.description ?? undefined,
      location: result.location ?? undefined,
      url: result.url ?? undefined,
      status: result.status ?? undefined,
      categories: safeJsonParse<string[]>(result.categories),
      eventClass: result.eventClass ?? undefined,
      priority: result.priority ?? undefined,
      comment: result.comment ?? undefined,
      geo: result.geo ?? undefined,
      // Tier 2 - Recurrence (parsed JSON)
      recurrenceRule: safeJsonParse<object>(result.recurrenceRule),
      exceptionDates: safeJsonParse<object>(result.exceptionDates),
      recurrenceId: safeJsonParse<object>(result.recurrenceId),
      // Tier 3 - People (parsed JSON)
      organizer: safeJsonParse<object>(result.organizer),
      attendees: safeJsonParse<object[]>(result.attendees),
      // Other
      timeTransparent: result.timeTransparent ?? undefined,
      attach: result.attach ?? undefined,
    });
  }

  return syncableEvents;
};

const getEventsForDestination = async (
  database: BunSQLDatabase,
  destinationId: string,
): Promise<SyncableEvent[]> => {
  const sourceIds = await getMappedSourceIds(database, destinationId);

  if (sourceIds.length === EMPTY_SOURCES_COUNT) {
    return [];
  }

  return fetchEventsForSources(database, sourceIds);
};

export { getEventsForDestination };
