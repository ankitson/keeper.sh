import {
  OAuthCalendarProvider,
  createOAuthDestinationProvider,
  generateEventUid,
  getErrorMessage,
  isKeeperEvent,
} from "@keeper.sh/provider-core";
import type {
  BroadcastSyncStatus,
  DeleteResult,
  DestinationProvider,
  GoogleCalendarConfig,
  ListRemoteEventsOptions,
  OAuthTokenProvider,
  PushResult,
  RemoteEvent,
  SyncableEvent,
} from "@keeper.sh/provider-core";
import { WideEvent } from "@keeper.sh/log";
import { googleApiErrorSchema, googleEventListSchema } from "@keeper.sh/data-schemas";
import type { GoogleEvent } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { getStartOfToday } from "@keeper.sh/date-utils";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { GOOGLE_CALENDAR_API, GOOGLE_CALENDAR_MAX_RESULTS } from "../shared/api";
import { hasRateLimitMessage, isAuthError } from "../shared/errors";
import { parseEventTime } from "../shared/date-time";
import { getGoogleAccountsForUser } from "./sync";
import type { GoogleAccount } from "./sync";

interface GoogleCalendarProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
  broadcastSyncStatus?: BroadcastSyncStatus;
}

const createGoogleCalendarProvider = (
  config: GoogleCalendarProviderConfig,
): DestinationProvider => {
  const { database, oauthProvider, broadcastSyncStatus } = config;

  return createOAuthDestinationProvider<GoogleAccount, GoogleCalendarConfig>({
    broadcastSyncStatus,
    buildConfig: (db, account, broadcast) => ({
      accessToken: account.accessToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      accountId: account.accountId,
      broadcastSyncStatus: broadcast,
      calendarId: "primary",
      database: db,
      destinationId: account.destinationId,
      refreshToken: account.refreshToken,
      userId: account.userId,
    }),
    createProviderInstance: (providerConfig, oauth) =>
      new GoogleCalendarProviderInstance(providerConfig, oauth),
    database,
    getAccountsForUser: getGoogleAccountsForUser,
    oauthProvider,
  });
};

class GoogleCalendarProviderInstance extends OAuthCalendarProvider<GoogleCalendarConfig> {
  readonly name = "Google Calendar";
  readonly id = "google";

  protected oauthProvider: OAuthTokenProvider;

  constructor(config: GoogleCalendarConfig, oauthProvider: OAuthTokenProvider) {
    super(config);
    this.oauthProvider = oauthProvider;
  }

  protected isRateLimitError(error: string | undefined): boolean {
    return hasRateLimitMessage(error) && this.rateLimiter !== null;
  }

  async listRemoteEvents(options: ListRemoteEventsOptions): Promise<RemoteEvent[]> {
    await this.ensureValidToken();
    const remoteEvents: RemoteEvent[] = [];

    let pageToken: string | null = null;
    const today = getStartOfToday();

    do {
      const url = this.buildListEventsUrl(today, options.until, pageToken);

      const response = await fetch(url, {
        headers: this.headers,
        method: "GET",
      });

      if (!response.ok) {
        const body = await response.json();
        const { error } = googleApiErrorSchema.assert(body);

        if (isAuthError(response.status, error)) {
          await this.markNeedsReauthentication();
        }

        throw new Error(error?.message ?? response.statusText);
      }

      const body = await response.json();
      const data = googleEventListSchema.assert(body);

      for (const event of data.items ?? []) {
        const remoteEvent = GoogleCalendarProviderInstance.transformGoogleEvent(event);
        if (remoteEvent) {
          remoteEvents.push(remoteEvent);
        }
      }

      pageToken = data.nextPageToken ?? null;
    } while (pageToken);

    return remoteEvents;
  }

  private buildListEventsUrl(today: Date, until: Date, pageToken: string | null): URL {
    const url = new URL(
      `calendars/${encodeURIComponent(this.config.calendarId)}/events`,
      GOOGLE_CALENDAR_API,
    );

    url.searchParams.set("maxResults", String(GOOGLE_CALENDAR_MAX_RESULTS));
    url.searchParams.set("timeMin", today.toISOString());
    url.searchParams.set("timeMax", until.toISOString());
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    return url;
  }

  private static transformGoogleEvent(event: GoogleEvent): RemoteEvent | null {
    if (!event.iCalUID || !isKeeperEvent(event.iCalUID)) {
      return null;
    }

    const startTime = parseEventTime(event.start);
    const endTime = parseEventTime(event.end);

    if (!startTime || !endTime) {
      return null;
    }

    return {
      deleteId: event.iCalUID,
      endTime,
      isKeeperEvent: isKeeperEvent(event.iCalUID),
      startTime,
      uid: event.iCalUID,
    };
  }

  protected async pushEvent(event: SyncableEvent): Promise<PushResult> {
    const uid = generateEventUid();
    const resource = GoogleCalendarProviderInstance.toGoogleEvent(event, uid);

    try {
      const result = await this.createEvent(resource);
      if (result.success) {
        return { remoteId: uid, success: true };
      }
      return result;
    } catch (error) {
      WideEvent.error(error);
      return { error: getErrorMessage(error), success: false };
    }
  }

  private async createEvent(resource: GoogleEvent): Promise<PushResult> {
    const url = new URL(
      `calendars/${encodeURIComponent(this.config.calendarId)}/events`,
      GOOGLE_CALENDAR_API,
    );
    // Prevent Google from sending invite emails to attendees
    url.searchParams.set("sendUpdates", "none");

    // Log the request payload for debugging
    console.log("[Google Calendar] Creating event:", JSON.stringify(resource, null, 2));

    const response = await fetch(url, {
      body: JSON.stringify(resource),
      headers: this.headers,
      method: "POST",
    });

    if (!response.ok) {
      const body = await response.json();
      console.log("[Google Calendar] Error response:", JSON.stringify(body, null, 2));
      const { error } = googleApiErrorSchema.assert(body);

      const errorMessage = error?.message ?? response.statusText;

      if (isAuthError(response.status, error)) {
        return this.handleAuthErrorResponse(errorMessage);
      }

      return { error: errorMessage, success: false };
    }

    await response.json();
    return { success: true };
  }

  protected async deleteEvent(uid: string): Promise<DeleteResult> {
    try {
      const existing = await this.findEventByUid(uid);

      if (!existing?.id) {
        return { success: true };
      }

      const url = new URL(
        `calendars/${encodeURIComponent(this.config.calendarId)}/events/${encodeURIComponent(existing.id)}`,
        GOOGLE_CALENDAR_API,
      );
      // Prevent Google from sending cancellation emails to attendees
      url.searchParams.set("sendUpdates", "none");

      const response = await fetch(url, {
        headers: this.headers,
        method: "DELETE",
      });

      if (!response.ok && response.status !== HTTP_STATUS.NOT_FOUND) {
        const body = await response.json();
        const { error } = googleApiErrorSchema.assert(body);
        const errorMessage = error?.message ?? response.statusText;

        if (isAuthError(response.status, error)) {
          return this.handleAuthErrorResponse(errorMessage);
        }

        return { error: errorMessage, success: false };
      }

      return { success: true };
    } catch (error) {
      WideEvent.error(error);
      return { error: getErrorMessage(error), success: false };
    }
  }

  private async findEventByUid(uid: string): Promise<GoogleEvent | null> {
    const event = WideEvent.grasp();
    event?.startTiming("findEventByUid");

    const url = new URL(
      `calendars/${encodeURIComponent(this.config.calendarId)}/events`,
      GOOGLE_CALENDAR_API,
    );

    url.searchParams.set("iCalUID", uid);

    const response = await fetch(url, {
      headers: this.headers,
      method: "GET",
    });

    event?.endTiming("findEventByUid");

    if (!response.ok) {
      event?.set({ "find_event_by_uid.status": response.status });
      return null;
    }

    const body = await response.json();
    const { items } = googleEventListSchema.assert(body);
    const [item] = items ?? [];
    return item ?? null;
  }

  private static formatRecurrenceDate(value: unknown): string {
    const d = value instanceof Date ? value : new Date(value as string);
    return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }

  private static toGoogleEvent(event: SyncableEvent, uid: string): GoogleEvent {
    const hasRecurrence = Boolean(event.recurrenceRule);

    const recurrenceTimeZone = event.startTimeZone ?? "UTC";

    const googleEvent: GoogleEvent = {
      iCalUID: uid,
      start: {
        dateTime: event.startTime.toISOString(),
        ...(hasRecurrence && { timeZone: recurrenceTimeZone }),
      },
      end: {
        dateTime: event.endTime.toISOString(),
        ...(hasRecurrence && { timeZone: recurrenceTimeZone }),
      },
      summary: event.summary,
      description: event.description,
      location: event.location,
    };

    // Map status (Google uses lowercase)
    if (event.status) {
      const statusMap: Record<string, string> = {
        CONFIRMED: "confirmed",
        TENTATIVE: "tentative",
        CANCELLED: "cancelled",
      };
      googleEvent.status = statusMap[event.status.toUpperCase()] ?? event.status.toLowerCase();
    }

    // Map visibility (Google uses visibility instead of class)
    if (event.eventClass) {
      const classMap: Record<string, string> = {
        PUBLIC: "public",
        PRIVATE: "private",
        CONFIDENTIAL: "confidential",
      };
      googleEvent.visibility = classMap[event.eventClass.toUpperCase()] ?? "default";
    }

    // Map attendees (if present)
    if (event.attendees && Array.isArray(event.attendees)) {
      googleEvent.attendees = event.attendees.map((attendee: unknown) => {
        const a = attendee as { email?: string; cn?: string; partstat?: string; role?: string };
        return {
          email: a.email ?? "",
          displayName: a.cn,
          responseStatus: GoogleCalendarProviderInstance.mapAttendeeStatus(a.partstat),
          optional: a.role === "OPT-PARTICIPANT",
        };
      });
    }

    // Map recurrence (if present - Google uses RFC5545 RRULE strings)
    // The stored recurrenceRule follows the IcsRecurrenceRule shape from ts-ics
    if (event.recurrenceRule) {
      const rule = event.recurrenceRule as {
        frequency?: string;
        until?: { date?: unknown };
        count?: number;
        interval?: number;
        byDay?: Array<{ day: string; occurrence?: number }>;
        byMonth?: number[];
        byMonthday?: number[];
        bySetPos?: number[];
        byHour?: number[];
        byMinute?: number[];
        bySecond?: number[];
        byYearday?: number[];
        byWeekNo?: number[];
        workweekStart?: string;
      };
      const parts: string[] = [];
      if (rule.frequency) parts.push(`FREQ=${rule.frequency}`);
      if (rule.interval) parts.push(`INTERVAL=${rule.interval}`);
      if (rule.count) parts.push(`COUNT=${rule.count}`);
      if (rule.until?.date) {
        parts.push(`UNTIL=${GoogleCalendarProviderInstance.formatRecurrenceDate(rule.until.date)}`);
      }
      if (rule.byDay?.length) {
        const days = rule.byDay.map((d) =>
          d.occurrence ? `${d.occurrence}${d.day}` : d.day,
        );
        parts.push(`BYDAY=${days.join(",")}`);
      }
      if (rule.byMonth?.length) parts.push(`BYMONTH=${rule.byMonth.join(",")}`);
      if (rule.byMonthday?.length) parts.push(`BYMONTHDAY=${rule.byMonthday.join(",")}`);
      if (rule.bySetPos?.length) parts.push(`BYSETPOS=${rule.bySetPos.join(",")}`);
      if (rule.byYearday?.length) parts.push(`BYYEARDAY=${rule.byYearday.join(",")}`);
      if (rule.byWeekNo?.length) parts.push(`BYWEEKNO=${rule.byWeekNo.join(",")}`);
      if (rule.byHour?.length) parts.push(`BYHOUR=${rule.byHour.join(",")}`);
      if (rule.byMinute?.length) parts.push(`BYMINUTE=${rule.byMinute.join(",")}`);
      if (rule.bySecond?.length) parts.push(`BYSECOND=${rule.bySecond.join(",")}`);
      if (rule.workweekStart) parts.push(`WKST=${rule.workweekStart}`);
      if (parts.length > 0) {
        googleEvent.recurrence = [`RRULE:${parts.join(";")}`];
      }
    }

    return googleEvent;
  }

  private static mapAttendeeStatus(partstat: string | undefined): string {
    if (!partstat) return "needsAction";
    const statusMap: Record<string, string> = {
      ACCEPTED: "accepted",
      DECLINED: "declined",
      TENTATIVE: "tentative",
      "NEEDS-ACTION": "needsAction",
    };
    return statusMap[partstat.toUpperCase()] ?? "needsAction";
  }
}

export { createGoogleCalendarProvider };
export type { GoogleCalendarProviderConfig };
