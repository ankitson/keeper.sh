import { HTTP_STATUS, KEEPER_CATEGORY } from "@keeper.sh/constants";
import { WideEvent } from "@keeper.sh/log";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import {
  microsoftApiErrorSchema,
  outlookEventListSchema,
  outlookEventSchema,
} from "@keeper.sh/data-schemas";
import { getStartOfToday } from "@keeper.sh/date-utils";
import type {
  BroadcastSyncStatus,
  DeleteResult,
  DestinationProvider,
  ListRemoteEventsOptions,
  OAuthTokenProvider,
  OutlookCalendarConfig,
  PushResult,
  RemoteEvent,
  SyncableEvent,
} from "@keeper.sh/provider-core";
import {
  OAuthCalendarProvider,
  createOAuthDestinationProvider,
  getErrorMessage,
} from "@keeper.sh/provider-core";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { MICROSOFT_GRAPH_API, OUTLOOK_PAGE_SIZE } from "../shared/api";
import { hasRateLimitMessage, isAuthError } from "../shared/errors";
import { parseEventTime } from "../shared/date-time";
import type { OutlookAccount } from "./sync";
import { getOutlookAccountsForUser } from "./sync";

interface OutlookCalendarProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
  broadcastSyncStatus?: BroadcastSyncStatus;
}

const createOutlookCalendarProvider = (
  config: OutlookCalendarProviderConfig,
): DestinationProvider => {
  const { database, oauthProvider, broadcastSyncStatus } = config;

  return createOAuthDestinationProvider<OutlookAccount, OutlookCalendarConfig>({
    broadcastSyncStatus,
    buildConfig: (db, account, broadcast) => ({
      accessToken: account.accessToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      accountId: account.accountId,
      broadcastSyncStatus: broadcast,
      database: db,
      destinationId: account.destinationId,
      refreshToken: account.refreshToken,
      userId: account.userId,
    }),
    createProviderInstance: (providerConfig, oauth) =>
      new OutlookCalendarProviderInstance(providerConfig, oauth),
    database,
    getAccountsForUser: getOutlookAccountsForUser,
    oauthProvider,
  });
};

class OutlookCalendarProviderInstance extends OAuthCalendarProvider<OutlookCalendarConfig> {
  readonly name = "Outlook Calendar";
  readonly id = "outlook";

  protected oauthProvider: OAuthTokenProvider;

  constructor(config: OutlookCalendarConfig, oauthProvider: OAuthTokenProvider) {
    super(config);
    this.oauthProvider = oauthProvider;
  }

  protected isRateLimitError(error: string | undefined): boolean {
    return hasRateLimitMessage(error) && this.rateLimiter !== null;
  }

  async listRemoteEvents(options: ListRemoteEventsOptions): Promise<RemoteEvent[]> {
    await this.ensureValidToken();
    const remoteEvents: RemoteEvent[] = [];
    let nextLink: string | null = null;

    const today = getStartOfToday();

    do {
      const url = OutlookCalendarProviderInstance.buildListEventsUrl(today, options.until, nextLink);

      const response = await fetch(url, {
        headers: this.headers,
        method: "GET",
      });

      if (!response.ok) {
        const body = await response.json();
        const { error } = microsoftApiErrorSchema.assert(body);

        if (isAuthError(response.status, error)) {
          await this.markNeedsReauthentication();
        }

        throw new Error(error?.message ?? response.statusText);
      }

      const body = await response.json();
      const data = outlookEventListSchema.assert(body);

      for (const event of data.value ?? []) {
        const remoteEvent = OutlookCalendarProviderInstance.transformOutlookEvent(event);
        if (remoteEvent) {
          remoteEvents.push(remoteEvent);
        }
      }

      nextLink = data["@odata.nextLink"] ?? null;
    } while (nextLink);

    return remoteEvents;
  }

  private static buildListEventsUrl(today: Date, until: Date, nextLink: string | null): URL {
    if (nextLink) {
      return new URL(nextLink);
    }

    const url = new URL(`${MICROSOFT_GRAPH_API}/me/calendar/events`);
    url.searchParams.set(
      "$filter",
      `categories/any(c:c eq '${KEEPER_CATEGORY}') and start/dateTime ge '${today.toISOString()}' and start/dateTime le '${until.toISOString()}'`,
    );
    url.searchParams.set("$top", String(OUTLOOK_PAGE_SIZE));
    url.searchParams.set("$select", "id,iCalUId,subject,start,end,categories");

    return url;
  }

  private static transformOutlookEvent(event: OutlookEvent): RemoteEvent | null {
    const startTime = parseEventTime(event.start);
    const endTime = parseEventTime(event.end);

    if (!event.id || !event.iCalUId || !startTime || !endTime) {
      return null;
    }

    return {
      deleteId: event.id,
      endTime,
      isKeeperEvent: event.categories?.includes(KEEPER_CATEGORY) ?? false,
      startTime,
      uid: event.iCalUId,
    };
  }

  protected async pushEvent(event: SyncableEvent): Promise<PushResult> {
    const resource = OutlookCalendarProviderInstance.toOutlookEvent(event);

    try {
      return await this.createEvent(resource);
    } catch (error) {
      WideEvent.error(error);
      return {
        error: getErrorMessage(error),
        success: false,
      };
    }
  }

  private async createEvent(resource: OutlookEvent): Promise<PushResult> {
    const url = new URL(`${MICROSOFT_GRAPH_API}/me/calendar/events`);

    const response = await fetch(url, {
      body: JSON.stringify(resource),
      headers: this.headers,
      method: "POST",
    });

    if (!response.ok) {
      const body = await response.json();
      const { error } = microsoftApiErrorSchema.assert(body);
      const errorMessage = error?.message ?? response.statusText;

      if (isAuthError(response.status, error)) {
        return this.handleAuthErrorResponse(errorMessage);
      }

      return { error: errorMessage, success: false };
    }

    const body = await response.json();
    const event = outlookEventSchema.assert(body);
    return { deleteId: event.id, remoteId: event.iCalUId, success: true };
  }

  protected async deleteEvent(eventId: string): Promise<DeleteResult> {
    try {
      const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${eventId}`);

      const response = await fetch(url, {
        headers: this.headers,
        method: "DELETE",
      });

      if (!response.ok && response.status !== HTTP_STATUS.NOT_FOUND) {
        const body = await response.json();
        const { error } = microsoftApiErrorSchema.assert(body);
        const errorMessage = error?.message ?? response.statusText;

        if (isAuthError(response.status, error)) {
          return this.handleAuthErrorResponse(errorMessage);
        }

        return { error: errorMessage, success: false };
      }

      return { success: true };
    } catch (error) {
      WideEvent.error(error);
      return {
        error: getErrorMessage(error),
        success: false,
      };
    }
  }

  private static getBodyFromSyncableEvent(event: SyncableEvent): OutlookEvent["body"] {
    if (!event.description) {
      return null;
    }

    return {
      content: event.description,
      contentType: "text",
    };
  }

  private static getLocationFromSyncableEvent(event: SyncableEvent): OutlookEvent["location"] {
    if (!event.location) {
      return null;
    }

    return {
      displayName: event.location,
    };
  }

  private static toOutlookEvent(event: SyncableEvent): OutlookEvent {
    const body = OutlookCalendarProviderInstance.getBodyFromSyncableEvent(event);
    const location = OutlookCalendarProviderInstance.getLocationFromSyncableEvent(event);

    const outlookEvent: OutlookEvent = {
      ...(body && { body }),
      ...(location && { location }),
      categories: [KEEPER_CATEGORY],
      end: { dateTime: event.endTime.toISOString(), timeZone: "UTC" },
      start: { dateTime: event.startTime.toISOString(), timeZone: "UTC" },
      subject: event.summary,
    };

    // Map showAs (Outlook's equivalent of timeTransparent)
    if (event.timeTransparent === "TRANSPARENT") {
      outlookEvent.showAs = "free";
    } else {
      outlookEvent.showAs = "busy";
    }

    // Map sensitivity (Outlook's equivalent of class)
    if (event.eventClass) {
      const sensitivityMap: Record<string, string> = {
        PUBLIC: "normal",
        PRIVATE: "private",
        CONFIDENTIAL: "confidential",
      };
      outlookEvent.sensitivity = sensitivityMap[event.eventClass.toUpperCase()] ?? "normal";
    }

    // Map importance (Outlook's equivalent of priority)
    if (event.priority) {
      const priority = parseInt(event.priority, 10);
      if (!isNaN(priority)) {
        if (priority <= 3) {
          outlookEvent.importance = "high";
        } else if (priority >= 7) {
          outlookEvent.importance = "low";
        } else {
          outlookEvent.importance = "normal";
        }
      }
    }

    // Map attendees (if present)
    if (event.attendees && Array.isArray(event.attendees)) {
      outlookEvent.attendees = event.attendees.map((attendee: unknown) => {
        const a = attendee as { email?: string; cn?: string; partstat?: string; role?: string };
        return {
          emailAddress: {
            address: a.email ?? "",
            name: a.cn,
          },
          status: {
            response: OutlookCalendarProviderInstance.mapAttendeeStatus(a.partstat),
          },
          type: a.role === "OPT-PARTICIPANT" ? "optional" : "required",
        };
      });
    }

    // Map recurrence (if present - Outlook uses a complex recurrence object)
    if (event.recurrenceRule) {
      const rule = event.recurrenceRule as { freq?: string; until?: string; count?: number; interval?: number; byday?: string[] };
      if (rule.freq) {
        const pattern: Record<string, unknown> = {
          type: OutlookCalendarProviderInstance.mapRecurrenceFreq(rule.freq),
          interval: rule.interval ?? 1,
        };

        const range: Record<string, unknown> = {
          startDate: event.startTime.toISOString().split("T")[0],
          type: "noEnd",
        };

        if (rule.count) {
          range.type = "numbered";
          range.numberOfOccurrences = rule.count;
        } else if (rule.until) {
          range.type = "endDate";
          range.endDate = rule.until;
        }

        if (rule.byday && rule.byday.length > 0) {
          pattern.daysOfWeek = rule.byday.map((day: string) => {
            const dayMap: Record<string, string> = {
              SU: "sunday",
              MO: "monday",
              TU: "tuesday",
              WE: "wednesday",
              TH: "thursday",
              FR: "friday",
              SA: "saturday",
            };
            return dayMap[day.toUpperCase()] ?? day.toLowerCase();
          });
        }

        outlookEvent.recurrence = { pattern, range };
      }
    }

    return outlookEvent;
  }

  private static mapAttendeeStatus(partstat: string | undefined): string {
    if (!partstat) return "none";
    const statusMap: Record<string, string> = {
      ACCEPTED: "accepted",
      DECLINED: "declined",
      TENTATIVE: "tentativelyAccepted",
      "NEEDS-ACTION": "none",
    };
    return statusMap[partstat.toUpperCase()] ?? "none";
  }

  private static mapRecurrenceFreq(freq: string): string {
    const freqMap: Record<string, string> = {
      DAILY: "daily",
      WEEKLY: "weekly",
      MONTHLY: "absoluteMonthly",
      YEARLY: "absoluteYearly",
    };
    return freqMap[freq.toUpperCase()] ?? "daily";
  }
}

export { createOutlookCalendarProvider };
export type { OutlookCalendarProviderConfig };
