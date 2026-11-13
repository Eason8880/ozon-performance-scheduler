import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeActionRunCursor,
  encodeActionRunCursor,
  pageActionRuns,
  type ActionRunRow,
  canReadStoreLogs,
} from "../src/lib/action-runs";

function run(id: string, created_at: string): ActionRunRow {
  return {
    id,
    created_at,
    action_key: `key-${id}`,
    action: "activate",
    status: "success",
    detail: null,
    source: "scheduled",
  };
}

test("pages five at a time with exact microsecond cursor and bigint IDs", () => {
  const rows = [
    run("9007199254740998", "2026-11-13T09:00:00.123457Z"),
    run("9007199254740997", "2026-11-13T09:00:00.123456Z"),
    run("9007199254740996", "2026-11-13T09:00:00.123456Z"),
    run("9007199254740995", "2026-11-13T09:00:00.123456Z"),
    run("9007199254740994", "2026-11-13T09:00:00.123456Z"),
    run("9007199254740993", "2026-11-13T09:00:00.123456Z"),
    run("9007199254740992", "2026-11-13T09:00:00.123455Z"),
  ];
  const first = pageActionRuns(rows.slice(0, 6));
  assert.equal(first.items.length, 5);
  assert.equal(first.hasMore, true);
  assert.equal(first.items[0].id, "9007199254740998");
  const cursor = decodeActionRunCursor(first.nextCursor!);
  assert.deepEqual(cursor, {
    createdAt: "2026-11-13T09:00:00.123456Z",
    id: "9007199254740994",
  });
  assert.equal(typeof first.items[0].id, "string");

  // Simulate the tuple comparison used by PostgreSQL after the first page.
  const older = rows.filter(
    (row) =>
      row.created_at < cursor!.createdAt ||
      (row.created_at === cursor!.createdAt &&
        BigInt(row.id) < BigInt(cursor!.id)),
  );
  const second = pageActionRuns(older);
  assert.deepEqual(
    [...first.items, ...second.items].map((item) => item.id),
    rows.map((item) => item.id),
  );
  assert.equal(second.hasMore, false);
  assert.notEqual(second.nextCursor, null);
});

test("exact five and empty tail do not show another page", () => {
  const five = Array.from({ length: 5 }, (_, index) =>
    run(String(index + 1), `2026-11-13T09:00:0${index}.000000Z`),
  );
  assert.deepEqual(pageActionRuns(five), {
    items: five,
    hasMore: false,
    nextCursor: encodeActionRunCursor({
      createdAt: five[4].created_at,
      id: five[4].id,
    }),
  });
  assert.deepEqual(pageActionRuns([]), {
    items: [],
    hasMore: false,
    nextCursor: null,
  });
});

test("cursor validation rejects malformed dates and out-of-range bigint IDs", () => {
  const make = (createdAt: string, id: string) =>
    Buffer.from(JSON.stringify({ createdAt, id })).toString("base64url");
  assert.equal(
    decodeActionRunCursor(make("2026-02-30T12:00:00.000000Z", "1")),
    null,
  );
  assert.equal(
    decodeActionRunCursor(
      make("2026-11-13T12:00:00.000000Z", "9223372036854775808"),
    ),
    null,
  );
  assert.equal(decodeActionRunCursor("not-a-cursor"), null);
});

test("store log access respects group ownership", () => {
  assert.equal(canReadStoreLogs("oz1", "oz1"), true);
  assert.equal(canReadStoreLogs("oz1", "oz2"), false);
  assert.equal(canReadStoreLogs("admin", "oz2"), true);
});

test("log queries break same-timestamp ties by the numeric database ID", () => {
  const initialPage = readFileSync("src/app/api/stores/route.ts", "utf8");
  const nextPage = readFileSync(
    "src/app/api/stores/[id]/runs/route.ts",
    "utf8",
  );

  // Text ordering would put 9 ahead of 11; both queries must order by the
  // qualified BIGINT column, not the response's id::text alias.
  assert.notDeepEqual(["9", "10", "11"].sort().reverse(), ["11", "10", "9"]);
  assert.match(initialPage, /order by j\.created_at desc,\s*j\.id desc/i);
  assert.match(nextPage, /order by j\.created_at desc,\s*j\.id desc/i);
});
