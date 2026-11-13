import { test } from "node:test";
import assert from "node:assert/strict";
import { desiredState } from "../src/lib/schedule";
import {
  convertTimeBetweenTimezones,
  convertWindowsBetweenTimezones,
  validateWindows,
} from "../src/lib/windows";
import {
  cleanupScheduleSet,
  dailyEdges,
  isCurrentScheduleRevision,
  provisionScheduleSet,
  scheduleDefinitions,
} from "../src/lib/store-schedules";
import { retryDirective } from "../src/lib/queue-retry";

const oneWindow = (start: string, stop: string) => [{ start, stop }];

test("uses the configured Moscow local time", () => {
  const result = desiredState(
    new Date("2026-11-13T07:00:00Z"),
    "Europe/Moscow",
    oneWindow("10:00", "20:00"),
  );
  assert.deepEqual(result, { active: true, key: "on:2026-11-13T10:00" });
});

test("supports a window crossing midnight and keys its opening to the prior local date", () => {
  const result = desiredState(
    new Date("2026-11-13T21:30:00Z"),
    "Europe/Moscow",
    oneWindow("22:00", "06:00"),
  );
  assert.deepEqual(result, { active: true, key: "on:2026-11-13T22:00" });
});

test("turns off at the exact end boundary", () => {
  const result = desiredState(
    new Date("2026-11-13T03:00:00Z"),
    "Europe/Moscow",
    oneWindow("22:00", "06:00"),
  );
  assert.deepEqual(result, { active: false, key: "off:2026-11-13T06:00" });
});

test("late polling preserves the transition key, making retries idempotent", () => {
  const windows = oneWindow("09:00", "21:00");
  const first = desiredState(
    new Date("2026-11-13T06:00:00Z"),
    "Europe/Moscow",
    windows,
  );
  const late = desiredState(
    new Date("2026-11-13T06:05:00Z"),
    "Europe/Moscow",
    windows,
  );
  assert.deepEqual(late, first);
});

test("supports the Shanghai timezone independently", () => {
  const result = desiredState(
    new Date("2026-11-13T01:00:00Z"),
    "Asia/Shanghai",
    oneWindow("09:00", "21:00"),
  );
  assert.deepEqual(result, { active: true, key: "on:2026-11-13T09:00" });
});

test("does not close the promotion at midnight before a normal day's opening", () => {
  const windows = oneWindow("09:00", "21:00");
  const midnight = desiredState(
    new Date("2026-11-12T21:00:00Z"),
    "Europe/Moscow",
    windows,
  );
  const beforeOpen = desiredState(
    new Date("2026-11-13T05:00:00Z"),
    "Europe/Moscow",
    windows,
  );
  assert.deepEqual(midnight, { active: false, key: "off:2026-11-12T21:00" });
  assert.deepEqual(beforeOpen, midnight);
});

test("uses today's off transition after the daily stop boundary", () => {
  const result = desiredState(
    new Date("2026-11-13T18:00:00Z"),
    "Europe/Moscow",
    oneWindow("09:00", "21:00"),
  );
  assert.deepEqual(result, { active: false, key: "off:2026-11-13T21:00" });
});

test("combines several daily windows and switches at their union boundaries", () => {
  const windows = [
    { start: "09:00", stop: "11:00" },
    { start: "19:00", stop: "23:00" },
  ];
  assert.equal(
    desiredState(new Date("2026-11-13T07:00:00Z"), "Europe/Moscow", windows)
      .active,
    true,
  );
  assert.equal(
    desiredState(new Date("2026-11-13T12:00:00Z"), "Europe/Moscow", windows)
      .active,
    false,
  );
  assert.equal(
    desiredState(new Date("2026-11-13T17:00:00Z"), "Europe/Moscow", windows)
      .active,
    true,
  );
});

test("handles a full-day union with a stable idempotency key", () => {
  const windows = [
    { start: "09:00", stop: "12:00" },
    { start: "12:00", stop: "09:00" },
  ];
  assert.equal(validateWindows(windows), true);
  assert.deepEqual(
    desiredState(new Date("2026-11-13T00:00:00Z"), "Europe/Moscow", windows),
    { active: true, key: "on:continuous" },
  );
});

test("rejects overlapping windows, including overlap across midnight", () => {
  assert.equal(
    validateWindows([
      { start: "09:00", stop: "13:00" },
      { start: "12:00", stop: "14:00" },
    ]),
    false,
  );
  assert.equal(
    validateWindows([
      { start: "22:00", stop: "02:00" },
      { start: "01:00", stop: "04:00" },
    ]),
    false,
  );
});

test("converts the Moscow preset windows to Beijing local time", () => {
  assert.equal(
    convertTimeBetweenTimezones("19:00", "Europe/Moscow", "Asia/Shanghai"),
    "00:00",
  );
  assert.equal(
    convertTimeBetweenTimezones("23:00", "Europe/Moscow", "Asia/Shanghai"),
    "04:00",
  );
  assert.equal(
    convertTimeBetweenTimezones("09:00", "Europe/Moscow", "Asia/Shanghai"),
    "14:00",
  );
  assert.equal(
    convertTimeBetweenTimezones("11:00", "Europe/Moscow", "Asia/Shanghai"),
    "16:00",
  );
  const windows = convertWindowsBetweenTimezones(
    [{ start: "19:00", stop: "23:00" }],
    "Europe/Moscow",
    "Asia/Shanghai",
  );
  assert.deepEqual(windows, [{ start: "00:00", stop: "04:00" }]);
  assert.deepEqual(
    convertWindowsBetweenTimezones(windows, "Asia/Shanghai", "Europe/Moscow"),
    [{ start: "19:00", stop: "23:00" }],
  );
});

test("daily Vercel schedules follow union edges and timezone", () => {
  const windows = [
    { start: "09:00", stop: "11:00" },
    { start: "19:00", stop: "23:00" },
  ];
  assert.deepEqual(dailyEdges(windows), [
    { minute: 540, active: true },
    { minute: 660, active: false },
    { minute: 1140, active: true },
    { minute: 1380, active: false },
  ]);
  const schedules = scheduleDefinitions(
    "12345678-1234-1234-1234-123456789012",
    5,
    {
      timezone: "Europe/Moscow",
      windows,
      enabled: true,
    },
  );
  assert.equal(schedules.length, 4);
  assert.equal(schedules[0].expression.cron, "0 9 * * *");
  assert.equal(schedules[0].timezone, "Europe/Moscow");
  assert.deepEqual(schedules[0].payload, {
    storeId: "12345678-1234-1234-1234-123456789012",
    revision: 5,
  });
});

test("daily edge plan handles midnight and omits transitions for a full-day union", () => {
  assert.deepEqual(dailyEdges(oneWindow("22:00", "06:00")), [
    { minute: 360, active: false },
    { minute: 1320, active: true },
  ]);
  assert.deepEqual(
    dailyEdges([
      { start: "09:00", stop: "12:00" },
      { start: "12:00", stop: "09:00" },
    ]),
    [],
  );
  assert.deepEqual(dailyEdges([]), []);
});

test("a partial schedule create failure leaves revision and task names retryable", async () => {
  const definitions = scheduleDefinitions(
    "23456789-abcd-1234-abcd-123456789012",
    8,
    {
      timezone: "Europe/Moscow",
      windows: [
        { start: "09:00", stop: "11:00" },
        { start: "19:00", stop: "23:00" },
      ],
      enabled: true,
    },
  );
  const state = {
    status: "syncing",
    pendingRevision: 8,
    pendingNames: definitions.map(({ name }) => name),
  };
  let calls = 0;
  await assert.rejects(
    provisionScheduleSet(
      definitions,
      async () => {
        calls++;
        if (calls === 2) throw { code: "service_unavailable" };
      },
      async () => {
        state.status = "failed";
      },
    ),
    /Schedule provisioning failed/,
  );
  assert.equal(state.status, "failed");
  assert.equal(state.pendingRevision, 8);
  assert.deepEqual(
    state.pendingNames,
    definitions.map(({ name }) => name),
  );

  const retried: string[] = [];
  await provisionScheduleSet(
    definitions,
    async ({ name }) => {
      retried.push(name);
    },
    async () => assert.fail("retry unexpectedly failed"),
  );
  assert.deepEqual(retried, state.pendingNames);
});

test("failed schedule cleanup retains names for retry", async () => {
  const pendingNames: string[][] = [];
  const names = ["old-on", "old-off"];
  const cleaned = await cleanupScheduleSet(
    names,
    async () => {
      throw { code: "service_unavailable" };
    },
    async (retained) => {
      pendingNames.push(retained);
    },
  );
  assert.equal(cleaned, false);
  assert.deepEqual(pendingNames[0], names);
  const retried = await cleanupScheduleSet(
    pendingNames[0],
    async () => undefined,
    async () => assert.fail("successful retry must not mark pending"),
  );
  assert.equal(retried, true);
});

test("stale or disabled schedule revisions are rejected", () => {
  assert.equal(isCurrentScheduleRevision(true, 8, 7), false);
  assert.equal(isCurrentScheduleRevision(false, 8, 8), false);
  assert.equal(isCurrentScheduleRevision(true, 8, 8), true);
});

test("a late queue event is evaluated against current desired state", () => {
  const delayed = desiredState(
    new Date("2026-11-13T18:00:00Z"),
    "Europe/Moscow",
    oneWindow("09:00", "21:00"),
  );
  assert.deepEqual(delayed, {
    active: false,
    key: "off:2026-11-13T21:00",
  });
});

test("queue retries back off and stop after six deliveries", () => {
  assert.deepEqual(retryDirective(1), { afterSeconds: 60 });
  assert.deepEqual(retryDirective(2), { afterSeconds: 300 });
  assert.deepEqual(retryDirective(3), { afterSeconds: 900 });
  assert.deepEqual(retryDirective(4), { afterSeconds: 3600 });
  assert.deepEqual(retryDirective(5), { afterSeconds: 3600 });
  assert.deepEqual(retryDirective(6), { acknowledge: true });
});
