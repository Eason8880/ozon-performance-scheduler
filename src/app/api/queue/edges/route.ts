import { handleCallback } from "@vercel/queue";
import type { ScheduleQueueMessage } from "@vercel/schedules";
import { decrypt } from "@/lib/security";
import { lockPool, releaseStoreLock } from "@/lib/db";
import { desiredState, evaluationTime } from "@/lib/schedule";
import { setPromotion } from "@/lib/ozon";
import { isCurrentScheduleRevision } from "@/lib/store-schedules";
import { retryQueueMessage } from "@/lib/queue-retry";
import type { ActionSource } from "@/lib/action-log";

type EdgePayload = {
  storeId: string;
  revision: number;
  source?: ActionSource;
};

export const maxDuration = 60;
const queueCallback = handleCallback<
  ScheduleQueueMessage<EdgePayload> | EdgePayload
>(
  async (message) => {
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
    const source: ActionSource = scheduled
      ? "scheduled"
      : payload.source &&
          ["initial_sync", "config_sync", "state_sync"].includes(payload.source)
        ? payload.source
        : "state_sync";

    const client = await lockPool.connect();
    let acquired = false;
    try {
      const lock = await client.query(
        "select pg_try_advisory_lock(hashtext($1)) as acquired",
        [payload.storeId],
      );
      acquired = Boolean(lock.rows[0].acquired);
      if (!acquired) throw new Error("Store action is in progress");

      const result = await client.query("select * from stores where id=$1", [
        payload.storeId,
      ]);
      if (!result.rowCount) return;
      const store = result.rows[0];
      if (
        !isCurrentScheduleRevision(
          store.enabled,
          Number(store.schedule_revision),
          payload.revision,
        )
      )
        return;

      const windows = store.windows?.length
        ? store.windows
        : [{ start: store.start_time, stop: store.stop_time }];
      const target = desiredState(
        evaluationTime(
          scheduled
            ? (message as ScheduleQueueMessage<EdgePayload>).scheduledAt
            : undefined,
          new Date(),
        ),
        store.timezone,
        windows,
      );
      if (store.last_action_key === target.key) return;

      try {
        await setPromotion(
          store.client_id,
          decrypt(store.secret_enc),
          target.active,
        );
      } catch (error) {
        const status =
          error instanceof Error
            ? error.message.match(/\((\d{3})\)/)?.[1]
            : null;
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
        // Retries continue until the action succeeds; log a repeated identical
        // failure at most once an hour so the history stays readable.
        await client.query(
          `insert into job_runs(store_id,action_key,action,status,detail,source)
           select $1,$2,$3,'failed',$4,$5
           where not exists (
             select 1 from job_runs where store_id=$1 and action_key=$2
               and status='failed' and detail=$4
               and created_at > now() - interval '1 hour')`,
          [
            store.id,
            target.key,
            target.active ? "activate" : "deactivate",
            detail,
            source,
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
          "insert into job_runs(store_id,action_key,action,status,detail,source) values($1,$2,$3,'success',$4,$5)",
          [
            store.id,
            target.key,
            target.active ? "activate" : "deactivate",
            scheduled
              ? `schedule execution ${(message as ScheduleQueueMessage<EdgePayload>).executionId}`
              : source,
            source,
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
      if (acquired) await releaseStoreLock(client, payload.storeId);
      else client.release();
    }
  },
  { retry: retryQueueMessage },
);

export async function POST(request: Request) {
  return queueCallback(request);
}
