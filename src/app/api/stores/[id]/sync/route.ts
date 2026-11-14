import { NextResponse } from "next/server";
import { sessionGroup } from "@/lib/security";
import { pool } from "@/lib/db";
import { syncStoreSchedules } from "@/lib/store-schedules";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const group = await sessionGroup();
  if (!group) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "店铺不存在" }, { status: 404 });
  try {
    const result = await pool.query(
      "select * from stores where id=$1 and ($2='admin' or owner_group=$2)",
      [id, group],
    );
    if (!result.rowCount)
      return NextResponse.json({ error: "店铺不存在" }, { status: 404 });
    const store = result.rows[0];
    if (["delete_pending", "deleting"].includes(store.schedule_status))
      return NextResponse.json(
        { error: "这个店铺正在删除中，请点击「继续删除」。" },
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
      { error: "定时任务更新失败，请稍后重试。如果一直失败，请检查 Vercel Schedules 是否正常。" },
      { status: 503 },
    );
  }
}
