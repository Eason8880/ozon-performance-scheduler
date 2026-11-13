import { NextResponse } from "next/server";
import { authorized } from "@/lib/security";
import { initDb, pool } from "@/lib/db";
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
    await initDb();
    const windows = normalizeWindows(windowsInput);
    const r = await pool.query(
      "update stores set start_time=$1,stop_time=$2,windows=$3::jsonb,timezone=$4,enabled=$5,last_action_key=null,last_error=null,updated_at=now() where id=$6 returning id,name,timezone,start_time,stop_time,windows,enabled,last_action_at,last_error,created_at",
      [
        windows[0].start,
        windows[0].stop,
        JSON.stringify(windows),
        b.timezone,
        b.enabled,
        id,
      ],
    );
    if (!r.rowCount)
      return NextResponse.json({ error: "店铺不存在" }, { status: 404 });
    return NextResponse.json({ store: r.rows[0] });
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
    await initDb();
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id))
      return NextResponse.json({ error: "店铺不存在" }, { status: 404 });
    await pool.query("delete from stores where id=$1", [id]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "删除失败" }, { status: 503 });
  }
}
