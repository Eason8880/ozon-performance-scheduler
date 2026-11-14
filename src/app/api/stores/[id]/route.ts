import { NextResponse } from "next/server";
import { sessionGroup } from "@/lib/security";
import { pool } from "@/lib/db";
import {
  cleanupScheduleSet,
  deleteSchedules,
  syncStoreSchedules,
  type StoreScheduleConfig,
} from "@/lib/store-schedules";
import {
  normalizeWindows,
  validTimezone,
  validateWindows,
} from "@/lib/windows";
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const group = await sessionGroup();
  if (!group) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "店铺不存在" }, { status: 404 });
  const b = await req.json().catch(() => null);
  const windowsInput =
    b?.windows ??
    (typeof b?.start === "string" && typeof b?.stop === "string"
      ? [{ start: b.start, stop: b.stop }]
      : null);
  if (!b || !validTimezone(b.timezone) || typeof b.enabled !== "boolean")
    return NextResponse.json(
      { error: "提交的时区或开关状态不正确，请刷新页面后重试。" },
      { status: 400 },
    );
  if (!validateWindows(windowsInput))
    return NextResponse.json(
      { error: "时段设置有问题：至少要有 1 个、最多 8 个时段，开启和关闭时间不能相同，时段之间不能重叠。" },
      { status: 400 },
    );
  try {
    const windows = normalizeWindows(windowsInput);
    const exists = await pool.query(
      "select id from stores where id=$1 and ($2='admin' or owner_group=$2)",
      [id, group],
    );
    if (!exists.rowCount)
      return NextResponse.json({ error: "店铺不存在" }, { status: 404 });
    const config: StoreScheduleConfig = {
      timezone: b.timezone,
      windows: normalizeWindows(windows),
      enabled: b.enabled,
    };
    await syncStoreSchedules(id, config, "config_sync");
    const ready = await pool.query(
      "select id,name,timezone,start_time,stop_time,windows,enabled,last_action_at,last_error,created_at,schedule_status,schedule_error from stores where id=$1 and ($2='admin' or owner_group=$2)",
      [id, group],
    );
    return NextResponse.json({ store: ready.rows[0] });
  } catch {
    return NextResponse.json(
      { error: "没有保存成功，请稍后重试。" },
      { status: 503 },
    );
  }
}
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const group = await sessionGroup();
  if (!group) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id))
      return NextResponse.json({ error: "店铺不存在" }, { status: 404 });
    const lockClient = await pool.connect();
    const lockKey = id;
    let acquired = false;
    try {
      const lock = await lockClient.query(
        "select pg_try_advisory_lock(hashtext($1)) as acquired",
        [lockKey],
      );
      acquired = Boolean(lock.rows[0].acquired);
      if (!acquired)
        return NextResponse.json(
          { error: "这个店铺的定时任务正在更新，请稍后再试。" },
          { status: 409 },
        );
      const found = await lockClient.query(
        "select schedule_names,retired_schedule_names,pending_schedule_names from stores where id=$1 and ($2='admin' or owner_group=$2)",
        [id, group],
      );
      if (!found.rowCount)
        return NextResponse.json({ error: "店铺不存在" }, { status: 404 });
      await lockClient.query(
        "update stores set enabled=false,schedule_status='deleting' where id=$1",
        [id],
      );
      const names = [
        ...(found.rows[0].schedule_names ?? []),
        ...(found.rows[0].retired_schedule_names ?? []),
        ...(found.rows[0].pending_schedule_names ?? []),
      ];
      const cleaned = await cleanupScheduleSet(
        names,
        deleteSchedules,
        async () => {
          await lockClient.query(
            `update stores set schedule_status='delete_pending',
           schedule_error='Schedules could not be removed' where id=$1`,
            [id],
          );
        },
      );
      if (!cleaned) {
        return NextResponse.json(
          { error: "店铺已停用，但定时任务没有删除干净。请点击「继续删除」。" },
          { status: 503 },
        );
      }
      await lockClient.query("delete from stores where id=$1", [id]);
      return NextResponse.json({ ok: true });
    } finally {
      if (acquired) {
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
      } else {
        lockClient.release();
      }
    }
  } catch {
    return NextResponse.json({ error: "店铺没有删除成功，请稍后重试。" }, { status: 503 });
  }
}
