import { NextResponse } from "next/server";
import { initDb, pool } from "@/lib/db";
import { decrypt } from "@/lib/security";
import { desiredState } from "@/lib/schedule";
import { setPromotion } from "@/lib/ozon";
export const maxDuration = 60;
export async function GET(req: Request) {
  const token = process.env.CRON_SECRET;
  if (!token || req.headers.get("authorization") !== `Bearer ${token}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await initDb();
    const stores = await pool.query("select * from stores where enabled=true");
    let processed = 0,
      failed = 0;
    for (const store of stores.rows) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const lock = await client.query(
          "select pg_try_advisory_xact_lock(hashtext($1)) as acquired",
          [store.id],
        );
        if (!lock.rows[0].acquired) {
          await client.query("rollback");
          continue;
        }
        const fresh = await client.query(
          "select * from stores where id=$1 and enabled=true for update",
          [store.id],
        );
        if (!fresh.rowCount) {
          await client.query("commit");
          continue;
        }
        const s = fresh.rows[0];
        const target = desiredState(
          new Date(),
          s.timezone,
          s.start_time,
          s.stop_time,
        );
        if (s.last_action_key === target.key) {
          await client.query("commit");
          continue;
        }
        try {
          await setPromotion(s.client_id, decrypt(s.secret_enc), target.active);
          await client.query(
            "update stores set last_action_key=$1,last_action_at=now(),last_error=null where id=$2",
            [target.key, s.id],
          );
          await client.query(
            "insert into job_runs(store_id,action_key,action,status) values($1,$2,$3,$4)",
            [
              s.id,
              target.key,
              target.active ? "activate" : "deactivate",
              "success",
            ],
          );
          processed++;
        } catch (e) {
          const msg =
            e instanceof Error && e.name === "TimeoutError"
              ? "Ozon request timed out"
              : e instanceof Error && /\((\d{3})\)/.test(e.message)
                ? `Ozon request failed (${e.message.match(/\((\d{3})\)/)?.[1]})`
                : "Ozon request failed";
          await client.query("update stores set last_error=$1 where id=$2", [
            msg,
            s.id,
          ]);
          await client.query(
            "insert into job_runs(store_id,action_key,action,status,detail) values($1,$2,$3,$4,$5)",
            [
              s.id,
              target.key,
              target.active ? "activate" : "deactivate",
              "failed",
              msg,
            ],
          );
          failed++;
        }
        await client.query("commit");
      } catch {
        await client.query("rollback").catch(() => {});
        failed++;
      } finally {
        client.release();
      }
    }
    return NextResponse.json({ processed, failed, checked: stores.rowCount });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Scheduler failed" },
      { status: 503 },
    );
  }
}
