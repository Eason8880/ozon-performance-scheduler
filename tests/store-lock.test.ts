import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lockConnectionString } from "../src/lib/db";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const lockSites = [
  "../src/app/api/queue/edges/route.ts",
  "../src/app/api/stores/[id]/route.ts",
  "../src/lib/store-schedules.ts",
];

test("store locks use the direct database endpoint when one is configured", () => {
  assert.equal(
    lockConnectionString({
      DATABASE_URL: "postgresql://u:p@ep-x-pooler.neon.tech/db",
      DATABASE_URL_UNPOOLED: "postgresql://u:p@ep-x.neon.tech/db",
    }),
    "postgresql://u:p@ep-x.neon.tech/db",
  );
  assert.equal(
    lockConnectionString({ DATABASE_URL: "postgresql://localhost/db" }),
    "postgresql://localhost/db",
  );
  assert.equal(
    lockConnectionString({
      DATABASE_URL: "postgresql://localhost/db",
      DATABASE_URL_UNPOOLED: "",
    }),
    "postgresql://localhost/db",
  );
});

test("every advisory lock is taken on a direct connection and released through the shared helper", () => {
  for (const path of lockSites) {
    const source = read(path);
    assert.match(source, /pg_try_advisory_lock/, path);
    assert.match(source, /lockPool\.connect\(\)/, path);
    assert.doesNotMatch(source, /\bpool\.connect\(\)/, path);
    assert.doesNotMatch(source, /pg_advisory_unlock/, path);
    assert.match(source, /releaseStoreLock\(/, path);
  }
});

test("schedule sync reads the status it uses to refuse stores being deleted", () => {
  const source = read("../src/lib/store-schedules.ts");
  const query = source.match(
    /`select (schedule_status,[^`]*) from stores where id=\$1`/,
  );
  assert.ok(query, "sync must select schedule_status");
  assert.match(
    source,
    /\["deleting", "delete_pending"\]\.includes\(current\.rows\[0\]\.schedule_status\)/,
  );
});
