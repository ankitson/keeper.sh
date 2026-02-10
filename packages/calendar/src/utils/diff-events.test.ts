import { describe, expect, it } from "bun:test";
import { diffEvents } from "./diff-events";

describe("diffEvents", () => {
  it("replaces events when timezone changes", () => {
    const start = new Date("2026-02-10T02:00:00.000Z");
    const end = new Date("2026-02-10T04:00:00.000Z");

    const remote = [
      {
        uid: "event@example.com",
        startTime: start,
        endTime: end,
        startTimeZone: "America/Los_Angeles",
      },
    ];

    const stored = [
      {
        id: "event-state-id",
        uid: "event@example.com",
        startTime: start,
        endTime: end,
      },
    ];

    const { toAdd, toRemove } = diffEvents(remote, stored);

    expect(toAdd).toHaveLength(1);
    expect(toRemove).toHaveLength(1);
  });

  it("does not replace events when timezone is unchanged", () => {
    const start = new Date("2026-02-10T02:00:00.000Z");
    const end = new Date("2026-02-10T04:00:00.000Z");

    const remote = [
      {
        uid: "event@example.com",
        startTime: start,
        endTime: end,
        startTimeZone: "America/Los_Angeles",
      },
    ];

    const stored = [
      {
        id: "event-state-id",
        uid: "event@example.com",
        startTime: start,
        endTime: end,
        startTimeZone: "America/Los_Angeles",
      },
    ];

    const { toAdd, toRemove } = diffEvents(remote, stored);

    expect(toAdd).toHaveLength(0);
    expect(toRemove).toHaveLength(0);
  });
});
