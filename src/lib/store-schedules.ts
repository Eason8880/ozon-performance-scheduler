import { Schedules } from "@vercel/schedules";
import { send } from "@vercel/queue";
import type { PoolClient } from "pg";
import { normalizeWindows, type TimeWindow } from "./windows";
import { pool } from "./db";
import type { ActionSource } from "./action-log";

export const STORE_SCHEDULE_TOPIC = "ozon-promo-edge";
export type StoreScheduleConfig = {
  timezone: string;
  windows: TimeWindow[];
  enabled: boolean;
};
export type StoreEdge = { minute: number; active: boolean };

/** Return only transitions in the union of the configured daily intervals. */
export function dailyEdges(windows: TimeWindow[]): StoreEdge[] {
  const activeAt = (minute: number) =>
    windows.some(({ start, stop }) => {
      const begin = minuteOf(start);
      const end = minuteOf(stop);
      return begin < end
        ? minute >= begin && minute < end
        : minute >= begin || minute < end;
    });
  const edges: StoreEdge[] = [];
  for (let minute = 0; minute < 1440; minute++) {
    const previous = (minute + 1439) % 1440;
    if (activeAt(previous) !== activeAt(minute)) {
      edges.push({ minute, active: activeAt(minute) });
    }
  }
  return edges;
}

export function scheduleName(
  storeId: string,
  revision: number,
  edge: StoreEdge,
) {
  const hhmm = String(edge.minute).padStart(4, "0");
  return `ozon-${storeId}-${revision}-${hhmm}-${edge.active ? "on" : "off"}`;
}

export function scheduleDefinitions(
  storeId: string,
  revision: number,
  config: StoreScheduleConfig,
) {
  if (!config.enabled) return [];
  return dailyEdges(config.windows).map((edge) => {
    const hour = Math.floor(edge.minute / 60);
    const minute = edge.minute % 60;
    return {
      name: scheduleName(storeId, revision, edge),
      expression: {
        type: "cron" as const,
        cron: `${minute} ${hour} * * *`,
      },
      timezone: config.timezone,
      target: { topic: STORE_SCHEDULE_TOPIC },
      payload: { storeId, revision, source: "scheduled" as const },
    };
  });
}

export async function ensureDynamicSchedule(
  definition: ReturnType<typeof scheduleDefinitions>[number],
) {
  try {
    await Schedules.create(definition);
  } catch (error) {
    if (!isCode(error, "schedule_already_exists")) throw error;
    await Schedules.update({
      name: definition.name,
      expression: definition.expression,
      timezone: definition.timezone,
      target: definition.target,
      payload: definition.payload,
    });
  }
}

export async function provisionScheduleSet(
  definitions: ReturnType<typeof scheduleDefinitions>,
  ensure: (definition: (typeof definitions)[number]) => Promise<void>,
  onFailure: (error: unknown) => Promise<void>,
) {
  try {
    for (const definition of definitions) await ensure(definition);
  } catch (error) {
    await onFailure(error);
    throw new Error("Schedule provisioning failed; retry synchronization");
  }
}

export async function removeScheduleSet(
  names: string[],
  remove: (name: string) => Promise<void> = (name) =>
    Schedules.delete({ name }),
) {
  const outcomes = await Promise.allSettled(names.map((name) => remove(name)));
  const failed = outcomes.find(
    (outcome) =>
      outcome.status === "rejected" && !isCode(outcome.reason, "not_found"),
  );
  if (failed?.status === "rejected") throw failed.reason;
}

export async function cleanupScheduleSet(
  names: string[],
  remove: (names: string[]) => Promise<void>,
  persistPending: (names: string[]) => Promise<void>,
) {
  try {
    await remove(names);
    return true;
  } catch {
    await persistPending(names);
    return false;
  }
}

export async function deleteSchedules(names: string[]) {
  await removeScheduleSet(names);
}

export function isCurrentScheduleRevision(
  enabled: boolean,
  activeRevision: number,
  payloadRevision: number,
) {
  return enabled && activeRevision === payloadRevision;
}

export async function syncStoreSchedules(
  storeId: string,
  config: StoreScheduleConfig,
  source: Extract<
    ActionSource,
    "initial_sync" | "config_sync" | "state_sync"
  > = "state_sync",
) {
  const lockClient = await pool.connect();
  // Keep the key compatible with the old polling handler during rollout.
  const lockKey = storeId;
  try {
    const locked = await lockClient.query(
      "select pg_try_advisory_lock(hashtext($1)) as acquired",
      [lockKey],
    );
    if (!locked.rows[0].acquired)
      throw new Error("A schedule update is already running for this store");
    await syncStoreSchedulesUnlocked(storeId, config, source, lockClient);
  } finally {
    try {
      await lockClient.query("select pg_advisory_unlock(hashtext($1))", [
        lockKey,
      ]);
      lockClient.release();
    } catch (error) {
      lockClient.release(
        error instanceof Error ? error : new Error("unlock failed"),
      );
    }
  }
}

async function syncStoreSchedulesUnlocked(
  storeId: string,
  config: StoreScheduleConfig,
  source: Extract<ActionSource, "initial_sync" | "config_sync" | "state_sync">,
  client: PoolClient,
) {
  const current = await client.query(
    `select schedule_revision,schedule_names,retired_schedule_names,
      pending_revision,pending_config,pending_schedule_names from stores where id=$1`,
    [storeId],
  );
  if (!current.rowCount) throw new Error("Store no longer exists");
  if (["deleting", "delete_pending"].includes(current.rows[0].schedule_status))
    throw new Error("Store deletion is pending; synchronize is disabled");
  const activeRevision = Number(current.rows[0].schedule_revision);
  const pendingConfig = current.rows[0]
    .pending_config as StoreScheduleConfig | null;
  const samePending = pendingConfig && configsEqual(pendingConfig, config);
  const revision = samePending
    ? Number(current.rows[0].pending_revision)
    : Math.max(
        activeRevision + 1,
        Number(current.rows[0].pending_revision ?? activeRevision) +
          (current.rows[0].pending_revision == null ? 0 : 1),
      );
  const retiredNames: string[] = [
    ...(current.rows[0].retired_schedule_names ?? []),
    ...(!samePending ? (current.rows[0].pending_schedule_names ?? []) : []),
  ];
  const oldNames: string[] = [
    ...(current.rows[0].schedule_names ?? []),
    ...retiredNames,
    ...(!samePending ? (current.rows[0].pending_schedule_names ?? []) : []),
  ];
  const definitions = scheduleDefinitions(storeId, revision, config);
  const newNames = definitions.map(({ name }) => name);
  await client.query(
    `update stores set pending_config=$1::jsonb,pending_revision=$2,
     pending_schedule_names=$3,retired_schedule_names=$4,
     schedule_status='syncing',schedule_error=null
     where id=$5`,
    [JSON.stringify(config), revision, newNames, retiredNames, storeId],
  );

  try {
    await provisionScheduleSet(
      definitions,
      ensureDynamicSchedule,
      async (error) => {
        await client.query(
          "update stores set schedule_status='failed',schedule_error=$1 where id=$2",
          [safeScheduleError(error), storeId],
        );
      },
    );
  } catch (error) {
    throw error;
  }

  try {
    await client.query("begin");
    const fresh = await client.query(
      "select pending_revision,pending_config from stores where id=$1 for update",
      [storeId],
    );
    if (
      !fresh.rowCount ||
      Number(fresh.rows[0].pending_revision) !== revision
    ) {
      throw new Error("Schedule configuration changed during synchronization");
    }
    const pending = fresh.rows[0].pending_config as StoreScheduleConfig;
    await client.query(
      `update stores set timezone=$1,start_time=$2,stop_time=$3,windows=$4::jsonb,
       enabled=$5,schedule_revision=$6,schedule_names=$7,schedule_status=$8,
       retired_schedule_names=$10,
       schedule_error=null,pending_config=null,pending_revision=null,
       pending_schedule_names=null,last_action_key=null,last_error=null,updated_at=now()
       where id=$9`,
      [
        pending.timezone,
        pending.windows[0].start,
        pending.windows[0].stop,
        JSON.stringify(pending.windows),
        pending.enabled,
        revision,
        newNames,
        pending.enabled ? "active" : "disabled",
        storeId,
        oldNames,
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    // The session-level advisory lock stays held across the transaction.
  }

  await cleanupScheduleSet(oldNames, deleteSchedules, async (names) => {
    await client.query(
      `update stores set retired_schedule_names=$1,schedule_status='cleanup_pending',
         schedule_error='Old schedules could not be removed' where id=$2`,
      [names, storeId],
    );
  }).then(async (cleaned) => {
    if (!cleaned) return;
    await client.query(
      "update stores set retired_schedule_names='{}',schedule_status=$1,schedule_error=null where id=$2",
      [config.enabled ? "active" : "disabled", storeId],
    );
  });

  if (config.enabled) {
    try {
      await send(STORE_SCHEDULE_TOPIC, { storeId, revision, source });
    } catch {
      await client.query(
        "update stores set schedule_status='action_pending',schedule_error='Initial state synchronization is pending' where id=$1",
        [storeId],
      );
      throw new Error(
        "Schedule saved, but initial state synchronization failed",
      );
    }
  }
}

function configsEqual(a: StoreScheduleConfig, b: StoreScheduleConfig) {
  const normalize = (config: StoreScheduleConfig) => ({
    timezone: config.timezone,
    enabled: config.enabled,
    windows: normalizeWindows(config.windows),
  });
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function safeScheduleError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "unknown";
  return `Vercel Schedules error (${code.slice(0, 60)})`;
}

export function isCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function minuteOf(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}
