import { test } from "node:test";
import assert from "node:assert/strict";
import { desiredState } from "../src/lib/schedule";

test("uses the configured Moscow local time", () => {
  const result = desiredState(
    new Date("2026-11-13T07:00:00Z"),
    "Europe/Moscow",
    "10:00",
    "20:00",
  );
  assert.deepEqual(result, { active: true, key: "on:2026-11-13" });
});

test("supports a window crossing midnight and keys its opening to the prior local date", () => {
  const result = desiredState(
    new Date("2026-11-13T21:30:00Z"),
    "Europe/Moscow",
    "22:00",
    "06:00",
  );
  assert.deepEqual(result, { active: true, key: "on:2026-11-13" });
});

test("turns off at the exact end boundary", () => {
  const result = desiredState(
    new Date("2026-11-13T03:00:00Z"),
    "Europe/Moscow",
    "22:00",
    "06:00",
  );
  assert.deepEqual(result, { active: false, key: "off:2026-11-13" });
});

test("late polling preserves the transition key, making retries idempotent", () => {
  const first = desiredState(
    new Date("2026-11-13T06:00:00Z"),
    "Europe/Moscow",
    "09:00",
    "21:00",
  );
  const late = desiredState(
    new Date("2026-11-13T06:05:00Z"),
    "Europe/Moscow",
    "09:00",
    "21:00",
  );
  assert.deepEqual(late, first);
});

test("supports the Shanghai timezone independently", () => {
  const result = desiredState(
    new Date("2026-11-13T01:00:00Z"),
    "Asia/Shanghai",
    "09:00",
    "21:00",
  );
  assert.deepEqual(result, { active: true, key: "on:2026-11-13" });
});
