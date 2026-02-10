## 2026-02-10 — Recurring Event Timezone Propagation
- Goal: fix recurring Fastmail events syncing to destination calendars with `UTC` instead of the source timezone.
- Decision: include `startTimeZone` in event diff identity so existing stored events without timezone are replaced on the next sync.
- Discovery: current diff logic only keyed on `uid + startTime + endTime`, so metadata-only changes (including timezone) were never persisted.
- Discovery: Google payload generation already uses `startTimeZone` for recurring events when available, so the missing propagation point was the source sync diff/update path.
- Next step: verify in runtime logs that recurring event payloads now include an IANA timezone (for example `America/Los_Angeles`) instead of `UTC`.
