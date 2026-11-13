const validTime = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (
    /^\d{2}:\d{2}$/.test(s) &&
    Number.isInteger(h) &&
    Number.isInteger(m) &&
    h >= 0 &&
    h < 24 &&
    m >= 0 &&
    m < 60
  );
};
import { NextResponse } from "next/server";
import { authorized } from "@/lib/security";
import { initDb, pool } from "@/lib/db";
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
  if (
    !b ||
    !validTime(b.start || "") ||
    !validTime(b.stop || "") ||
    b.start === b.stop ||
    !["Asia/Shanghai", "Europe/Moscow"].includes(b.timezone) ||
    typeof b.enabled !== "boolean"
  )
    return NextResponse.json({ error: "请检查时间和时区" }, { status: 400 });
  try {
    await initDb();
    const r = await pool.query(
      "update stores set start_time=$1,stop_time=$2,timezone=$3,enabled=$4,last_action_key=null,last_error=null,updated_at=now() where id=$5 returning id,name,timezone,start_time,stop_time,enabled,last_action_at,last_error,created_at",
      [b.start, b.stop, b.timezone, b.enabled, id],
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
