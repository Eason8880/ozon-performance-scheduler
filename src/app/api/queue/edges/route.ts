import { handleCallback } from "@vercel/queue";
import type { ScheduleQueueMessage } from "@vercel/schedules";
import { decrypt } from "@/lib/security";
import { pool } from "@/lib/db";
import { desiredState } from "@/lib/schedule";
import { setPromotion } from "@/lib/ozon";

type EdgePayload = { storeId: string; revision: number };

export const maxDuration = 60;
const queueCallback = handleCallback<
  ScheduleQueueMessage<EdgePayload> | EdgePayload
>(async (message) => {
  const scheduled = "payload" in message;
  const payload: EdgePayload | undefined = scheduled
    ? (message as ScheduleQueueMessage<EdgePayload>).payload
    : (message as EdgePayload);
  if (
    !payload ||
    !/^[0-9a-f-]{36}$/i.test(payload.storeId) ||
    !Number.isSafeInteger(payload.revision)
  ) {
    throw new Error("Invalid schedule payload");
  }

  const client = await pool.connect();
  const lockId = `ozon-store:${payload.storeId}`;
  try {
    const lock = await client.query(
      "select pg_try_advisory_lock(hashtext($1)) as acquired",
      [lockId],
    );
    if (!lock.rows[0].acquired) throw new Error("Store action is in progress");

    const result = await client.query("select * from stores where id=$1", [
      payload.storeId,
    ]);
    if (!result.rowCount) return;
    const store = result.rows[0];
    if (!store.enabled || Number(store.schedule_revision) !== payload.revision)
      return;

    const windows = store.windows?.length
      ? store.windows
      : [{ start: store.start_time, stop: store.stop_time }];
    const target = desiredState(new Date(), store.timezone, windows);
    if (store.last_action_key === target.key) return;

    try {
      await setPromotion(
        store.client_id,
        decrypt(store.secret_enc),
        target.active,
      );
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
        store.id,
      ]);
      await client.query(
        "insert into job_runs(store_id,action_key,action,status,detail) values($1,$2,$3,'failed',$4)",
        [
          store.id,
          target.key,
          target.active ? "activate" : "deactivate",
          detail,
        ],
      );
      throw new Error(detail);
    }

    try {
      await client.query("begin");
      await client.query(
        "update stores set last_action_key=$1,last_action_at=now(),last_error=null where id=$2",
        [target.key, store.id],
      );
      await client.query(
        "insert into job_runs(store_id,action_key,action,status,detail) values($1,$2,$3,'success',$4)",
        [
          store.id,
          target.key,
          target.active ? "activate" : "deactivate",
          scheduled
            ? `schedule execution ${(message as ScheduleQueueMessage<EdgePayload>).executionId}`
            : "initial state synchronization",
        ],
      );
      await client.query("commit");
    } catch {
      await client.query("rollback").catch(() => undefined);
      throw new Error(
        "Ozon action completed, but its result could not be saved",
      );
    }
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext($1))", [lockId]);
      client.release();
    } catch (error) {
      client.release(
        error instanceof Error ? error : new Error("unlock failed"),
      );
    }
  }
});

export async function POST(request: Request) {
  return queueCallback(request);
}
