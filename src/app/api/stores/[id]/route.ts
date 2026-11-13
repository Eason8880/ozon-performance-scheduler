import { NextResponse } from "next/server";
import { authorized } from "@/lib/security";
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
  if (!(await authorized()))
    return NextResponse.json({ error: "未登录" }, { status: 401 });
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
      { error: "请检查时区和启用状态" },
      { status: 400 },
    );
  if (!validateWindows(windowsInput))
    return NextResponse.json(
      { error: "时段无效、重叠或为空；请调整后再保存（最多8段）" },
      { status: 400 },
    );
  try {
    const windows = normalizeWindows(windowsInput);
    const exists = await pool.query("select id from stores where id=$1", [id]);
    if (!exists.rowCount)
      return NextResponse.json({ error: "店铺不存在" }, { status: 404 });
    const config: StoreScheduleConfig = {
      timezone: b.timezone,
      windows: normalizeWindows(windows),
      enabled: b.enabled,
    };
    await syncStoreSchedules(id, config);
    const ready = await pool.query(
      "select id,name,timezone,start_time,stop_time,windows,enabled,last_action_at,last_error,created_at,schedule_status,schedule_error from stores where id=$1",
      [id],
    );
    return NextResponse.json({ store: ready.rows[0] });
  } catch {
    return NextResponse.json(
      { error: "保存失败，请检查数据库设置" },
      { status: 503 },
    );
  }
}
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await authorized()))
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id))
      return NextResponse.json({ error: "店铺不存在" }, { status: 404 });
    const lockClient = await pool.connect();
    const lockKey = `ozon-store:${id}`;
    let acquired = false;
    try {
      const lock = await lockClient.query(
        "select pg_try_advisory_lock(hashtext($1)) as acquired",
        [lockKey],
      );
      acquired = Boolean(lock.rows[0].acquired);
      if (!acquired)
        return NextResponse.json(
          { error: "店铺计划正在同步，请稍后重试。" },
          { status: 409 },
        );
      const found = await lockClient.query(
        "select schedule_names,retired_schedule_names,pending_schedule_names from stores where id=$1",
        [id],
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
          { error: "店铺已停用，但定时任务删除失败；请再次删除以重试清理。" },
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
    return NextResponse.json({ error: "删除失败" }, { status: 503 });
  }
}
