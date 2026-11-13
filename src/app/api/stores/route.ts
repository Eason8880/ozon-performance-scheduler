import { NextResponse } from "next/server";
import { authorized, encrypt } from "@/lib/security";
import { checkCredentials } from "@/lib/ozon";
import { initDb, pool } from "@/lib/db";
import {
  normalizeWindows,
  validTimezone,
  validateWindows,
} from "@/lib/windows";
export async function GET() {
  if (!process.env.DATABASE_URL)
    return NextResponse.json(
      {
        code: "DATABASE_PENDING",
        error: "数据库尚未连接，请完成 PostgreSQL 配置。",
      },
      { status: 503 },
    );
  if (!(await authorized()))
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    await initDb();
    const r = await pool.query(
      `select s.id,s.name,s.timezone,s.start_time,s.stop_time,
       case when jsonb_array_length(s.windows)>0 then s.windows
         else jsonb_build_array(jsonb_build_object('start',s.start_time,'stop',s.stop_time)) end as windows,
       s.enabled,s.last_action_at,s.last_error,s.created_at,
       coalesce((select json_agg(x) from (select action_key,action,status,detail,created_at from job_runs where store_id=s.id order by created_at desc limit 5) x),'[]'::json) as runs
       from stores s order by s.created_at`,
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
  const windowsInput =
    b?.windows ??
    (typeof b?.start === "string" && typeof b?.stop === "string"
      ? [{ start: b.start, stop: b.stop }]
      : null);
  if (
    !b ||
    typeof b.name !== "string" ||
    typeof b.clientId !== "string" ||
    typeof b.clientSecret !== "string" ||
    !b.name.trim() ||
    !b.clientId.trim() ||
    !b.clientSecret.trim() ||
    !validTimezone(b.timezone)
  )
    return NextResponse.json(
      { error: "请检查店铺名称、凭据和时区" },
      { status: 400 },
    );
  if (!validateWindows(windowsInput))
    return NextResponse.json(
      { error: "时段无效、重叠或为空；请调整后再保存（最多8段）" },
      { status: 400 },
    );
  try {
    await checkCredentials(b.clientId.trim(), b.clientSecret.trim());
    await initDb();
    const windows = normalizeWindows(windowsInput);
    const r = await pool.query(
      "insert into stores(name,timezone,start_time,stop_time,windows,client_id,secret_enc) values($1,$2,$3,$4,$5::jsonb,$6,$7) returning id,name,timezone,start_time,stop_time,windows,enabled,last_action_at,last_error,created_at",
      [
        b.name.trim(),
        b.timezone,
        windows[0].start,
        windows[0].stop,
        JSON.stringify(windows),
        b.clientId.trim(),
        encrypt(b.clientSecret.trim()),
      ],
    );
    return NextResponse.json({ store: r.rows[0] }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error &&
          e.message.startsWith("Ozon authorization failed")
            ? e.message
            : "保存失败，请检查数据库连接",
      },
      { status: 503 },
    );
  }
}
