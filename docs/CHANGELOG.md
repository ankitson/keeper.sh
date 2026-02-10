## 2026-02-10
### Refresh Stored Events When Timezone Changes
- Modified `packages/calendar/src/utils/diff-events.ts` to include `startTimeZone` in event identity matching.
- Modified `packages/calendar/src/utils/sync-source-from-snapshot.ts` and `packages/sync-calendar/src/index.ts` to load stored `startTimeZone` from `event_states` during diffing.
- Added `packages/calendar/src/utils/diff-events.test.ts` to verify timezone changes cause remove/add replacement and unchanged timezone does not.

Why:
- Existing rows created before timezone propagation had `startTimeZone = null` and were never updated because times/UID were unchanged, causing recurring destination events to default to `UTC`.
