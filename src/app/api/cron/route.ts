import { NextResponse } from "next/server";
import { initDb, pool } from "@/lib/db";
import { decrypt } from "@/lib/security";
import { desiredState } from "@/lib/schedule";
import { setPromotion } from "@/lib/ozon";

export const maxDuration = 60;
const maxSchedulerWorkMs = 40_000;
const concurrency = 3;

type StoreRow = {
  id: string;
  timezone: string;
  start_time: string;
  stop_time: string;
  client_id: string;
  secret_enc: string;
  last_action_key: string | null;
  windows: { start: string; stop: string }[];
};

async function runStore(store: StoreRow) {
  const client = await pool.connect();
  let processed = 0;
  let failed = 0;
  try {
    await client.query("begin");
    const lock = await client.query(
      "select pg_try_advisory_xact_lock(hashtext($1)) as acquired",
      [store.id],
    );
    if (!lock.rows[0].acquired) {
      await client.query("rollback");
      return { processed, failed };
    }
    const fresh = await client.query(
      "select * from stores where id=$1 and enabled=true for update",
      [store.id],
    );
    if (!fresh.rowCount) {
      await client.query("commit");
      return { processed, failed };
    }

    const current = fresh.rows[0];
    const windows = current.windows?.length
      ? current.windows
      : [{ start: current.start_time, stop: current.stop_time }];
    const target = desiredState(new Date(), current.timezone, windows);
    if (current.last_action_key === target.key) {
      await client.query("commit");
      return { processed, failed };
    }

    try {
      await setPromotion(
        current.client_id,
        decrypt(current.secret_enc),
        target.active,
      );
      await client.query(
        "update stores set last_action_key=$1,last_action_at=now(),last_error=null where id=$2",
        [target.key, current.id],
      );
      await client.query(
        "insert into job_runs(store_id,action_key,action,status) values($1,$2,$3,$4)",
        [
          current.id,
          target.key,
          target.active ? "activate" : "deactivate",
          "success",
        ],
      );
      processed++;
    } catch (error) {
      const status =
        error instanceof Error ? error.message.match(/\((\d{3})\)/)?.[1] : null;
      const detail =
        error instanceof Error && error.name === "TimeoutError"
          ? "Ozon request timed out"
          : status
            ? `Ozon request failed (${status})`
            : "Ozon request failed";
      await client.query("update stores set last_error=$1 where id=$2", [
        detail,
        current.id,
      ]);
      await client.query(
        "insert into job_runs(store_id,action_key,action,status,detail) values($1,$2,$3,$4,$5)",
        [
          current.id,
          target.key,
          target.active ? "activate" : "deactivate",
          "failed",
          detail,
        ],
      );
      failed++;
    }
    await client.query("commit");
  } catch {
    await client.query("rollback").catch(() => undefined);
    failed++;
  } finally {
    client.release();
  }
  return { processed, failed };
}

export async function GET(req: Request) {
  const token = process.env.CRON_SECRET;
  if (!token || req.headers.get("authorization") !== `Bearer ${token}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await initDb();
    const stores = await pool.query(
      `select s.* from stores s
       where s.enabled=true
       order by (
         select max(j.created_at) from job_runs j where j.store_id=s.id
       ) asc nulls first, s.created_at asc`,
    );
    const startTime = Date.now();
    let processed = 0;
    let failed = 0;
    let index = 0;
    while (
      index < stores.rows.length &&
      Date.now() - startTime < maxSchedulerWorkMs
    ) {
      const batch = stores.rows.slice(index, index + concurrency);
      index += batch.length;
      const results = await Promise.all(batch.map(runStore));
      for (const result of results) {
        processed += result.processed;
        failed += result.failed;
      }
    }
    return NextResponse.json({
      processed,
      failed,
      checked: stores.rowCount,
      deferred: stores.rows.length - index,
    });
  } catch {
    return NextResponse.json(
      {
        error: "Scheduler failed; check DATABASE_URL and database availability",
      },
      { status: 503 },
    );
  }
}
