set shell := ["bash", "-cu"]

types:
    bun run types

lint:
    bun run lint

test-calendar:
    bun test packages/calendar/src/utils/*.test.ts
