const validTime = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (
    Number.isInteger(h) &&
    Number.isInteger(m) &&
    h >= 0 &&
    h < 24 &&
    m >= 0 &&
    m < 60
  );
};
import { NextResponse } from "next/server";
import { authorized, encrypt } from "@/lib/security";
import { checkCredentials } from "@/lib/ozon";
import { initDb, pool } from "@/lib/db";
export async function GET() {
  if (!(await authorized()))
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    await initDb();
    const r = await pool.query(
      `select s.id,s.name,s.timezone,s.start_time,s.stop_time,s.enabled,s.last_action_at,s.last_error,s.created_at,coalesce((select json_agg(x) from (select action_key,action,status,detail,created_at from job_runs where store_id=s.id order by created_at desc limit 5) x),'[]'::json) as runs from stores s order by s.created_at`,
    );
    return NextResponse.json({ stores: r.rows });
  } catch (e) {
    return NextResponse.json(
      { error: "数据库连接失败，请检查 DATABASE_URL" },
      { status: 503 },
    );
  }
}
export async function POST(req: Request) {
  if (!(await authorized()))
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (
    !b ||
    !["name", "clientId", "clientSecret", "start", "stop", "timezone"].every(
      (k) => typeof b[k] === "string",
    ) ||
    !/^\d\d:\d\d$/.test(b.start) ||
    !/^\d\d:\d\d$/.test(b.stop) ||
    b.start === b.stop ||
    !validTime(b.start) ||
    !validTime(b.stop) ||
    !b.name.trim() ||
    !b.clientId.trim() ||
    !b.clientSecret.trim() ||
    !["Asia/Shanghai", "Europe/Moscow"].includes(b.timezone)
  )
    return NextResponse.json(
      { error: "请检查店铺名称、凭据、时区和时间" },
      { status: 400 },
    );
  try {
    await checkCredentials(b.clientId.trim(), b.clientSecret.trim());
    await initDb();
    const r = await pool.query(
      "insert into stores(name,timezone,start_time,stop_time,client_id,secret_enc) values($1,$2,$3,$4,$5,$6) returning id,name,timezone,start_time,stop_time,enabled,last_action_at,last_error,created_at",
      [
        b.name.trim(),
        b.timezone,
        b.start,
        b.stop,
        b.clientId.trim(),
        encrypt(b.clientSecret.trim()),
      ],
    );
    return NextResponse.json({ store: r.rows[0] }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 503 },
    );
  }
}
