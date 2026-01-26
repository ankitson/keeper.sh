# Changelog

## 2026-01-26

### Features

#### Full Event Details Sync
Extended event syncing to include all ICS event properties instead of just timeslots:

**Tier 1 - Core Content:**
- summary, description, location, url, status, categories, class, priority, comment, geo

**Tier 2 - Recurrence:**
- recurrenceRule, exceptionDates, recurrenceId (stored as JSON)

**Tier 3 - People:**
- organizer, attendees (stored as JSON)

**Other:**
- timeTransparent, attach

### Database Changes
- Added 17 new columns to `event_states` table via migration `0037_event_details.sql`

### Bug Fixes

#### Events Disappearing After They End
**Problem:** Events were being automatically deleted from Google Calendar after the event time passed.

**Root Cause:** The `fetchEventsForSources` function filters events to only those where `startTime >= startOfToday`. When an event's start time moved to the past, it was no longer included in `localEvents`. The sync logic in `buildRemoveOperations` interpreted this as "event was deleted from source" and created a remove operation.

**Fix:** Modified `buildRemoveOperations` in `packages/provider-core/src/sync/provider.ts` to skip removing events where `mapping.startTime < startOfToday`. Past events now stay on the destination calendar.

**Learning:** When implementing time-windowed sync, be careful about how "missing" events are interpreted. An event outside the fetch window is not the same as a deleted event.

---

#### Timezone Error for CalDAV/ICS Events ("Missing time zone definition for start time")
**Problem:** Some events with recurrence rules failed to sync with the error "Missing time zone definition for start time."

**Root Cause:** Two issues:
1. The `ts-ics` library requires a `tzId` property on datetime objects, but the CalDAV provider was creating events with just `{ date: event.startTime }` without timezone info.
2. Recurring events store `recurrenceRule.until` as a complex object: `{ date: "2026-05-14T06:59:59.000Z", type: "DATE-TIME" }`. When `type` is `"DATE-TIME"`, the ts-ics library requires timezone information, but the code was passing this structure directly without transformation.

**Fix:**
1. Added `tzId: "UTC"` to start/end objects in `packages/provider-caldav/src/shared/ics.ts`
2. Created `transformRecurrenceRule()` function that converts the stored recurrence rule format to what ts-ics expects, including proper timezone handling for the `until` field

**Learning:** When working with calendar libraries, datetime fields often require explicit timezone information. The ICS/iCalendar spec (RFC 5545) distinguishes between DATE (no timezone) and DATE-TIME (requires timezone or UTC). Always check what format the library expects vs what's stored.

---

#### Email Invites Being Sent to Attendees
**Problem:** When syncing events with attendees to Google Calendar, invite and cancellation emails were being sent to all attendees.

**Root Cause:** The Google Calendar API sends notification emails by default when creating or deleting events that have attendees.

**Fix:** Added `sendUpdates=none` query parameter to both `createEvent` and `deleteEvent` API calls in `packages/provider-google-calendar/src/destination/provider.ts`.

**Learning:** Calendar APIs often have side effects like sending emails. Always check API documentation for parameters that control notifications/side effects, especially when building sync tools that may create/update/delete events frequently.

### Improvements

#### Better Error Logging for Failed Events
Added detailed logging to help diagnose sync failures:

- **provider-core/sync/provider.ts:** When an event fails to push, now logs the event ID, summary, start time, and end time alongside the error message
- **provider-caldav/destination/provider.ts:** Logs event details and generated ICS string before pushing, and logs event context on errors
- **provider-google-calendar/destination/provider.ts:** Logs the full request payload being sent to Google API, and logs error responses
