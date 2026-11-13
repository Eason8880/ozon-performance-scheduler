import { NextResponse } from "next/server";
import { authorized } from "@/lib/security";
import { pool } from "@/lib/db";
import { syncStoreSchedules } from "@/lib/store-schedules";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await authorized()))
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "店铺不存在" }, { status: 404 });
  try {
    const result = await pool.query("select * from stores where id=$1", [id]);
    if (!result.rowCount)
      return NextResponse.json({ error: "店铺不存在" }, { status: 404 });
    const store = result.rows[0];
    if (store.schedule_status === "delete_pending")
      return NextResponse.json(
        { error: "请使用删除操作重试清理" },
        { status: 409 },
      );
    const pending = store.pending_config;
    const config = pending ?? {
      timezone: store.timezone,
      windows: store.windows?.length
        ? store.windows
        : [{ start: store.start_time, stop: store.stop_time }],
      enabled: store.enabled,
    };
    await syncStoreSchedules(id, config);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "计划同步失败，请检查Vercel Schedules状态后重试。" },
      { status: 503 },
    );
  }
}
