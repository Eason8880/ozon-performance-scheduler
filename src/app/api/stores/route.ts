import { NextResponse } from "next/server";
import { sessionGroup, encrypt } from "@/lib/security";
import { checkCredentials } from "@/lib/ozon";
import { pool } from "@/lib/db";
import { syncStoreSchedules } from "@/lib/store-schedules";
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
  const group = await sessionGroup();
  if (!group) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const r = await pool.query(
      `select s.id,s.name,s.timezone,s.start_time,s.stop_time,
       case when jsonb_array_length(s.windows)>0 then s.windows
         else jsonb_build_array(jsonb_build_object('start',s.start_time,'stop',s.stop_time)) end as windows,
       s.enabled,s.last_action_key,s.last_action_at,s.last_error,s.created_at,
       s.schedule_status,s.schedule_error,
       coalesce((select json_agg(x) from (select action_key,action,status,detail,source,created_at from job_runs where store_id=s.id order by created_at desc limit 5) x),'[]'::json) as runs
       from stores s where $1='admin' or s.owner_group=$1 order by s.created_at`,
      [group],
    );
    return NextResponse.json({ stores: r.rows, group });
  } catch (e) {
    return NextResponse.json(
      { error: "数据库连接失败，请检查 DATABASE_URL" },
      { status: 503 },
    );
  }
}
export async function POST(req: Request) {
  const group = await sessionGroup();
  if (!group) return NextResponse.json({ error: "未登录" }, { status: 401 });
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
    const windows = normalizeWindows(windowsInput);
    const r = await pool.query(
      "insert into stores(name,timezone,start_time,stop_time,windows,client_id,secret_enc,schedule_status,pending_config,pending_revision,owner_group) values($1,$2,$3,$4,$5::jsonb,$6,$7,'pending',$8::jsonb,1,nullif($9,'admin')) returning id,name,timezone,start_time,stop_time,windows,enabled,last_action_at,last_error,created_at,schedule_status",
      [
        b.name.trim(),
        b.timezone,
        windows[0].start,
        windows[0].stop,
        JSON.stringify(windows),
        b.clientId.trim(),
        encrypt(b.clientSecret.trim()),
        JSON.stringify({ timezone: b.timezone, windows, enabled: true }),
        group,
      ],
    );
    try {
      await syncStoreSchedules(
        r.rows[0].id,
        {
          timezone: b.timezone,
          windows,
          enabled: true,
        },
        "initial_sync",
      );
    } catch {
      return NextResponse.json(
        {
          store: r.rows[0],
          error: "店铺已保存，但每日开关计划创建失败，请重试同步。",
        },
        { status: 503 },
      );
    }
    const ready = await pool.query(
      "select id,name,timezone,start_time,stop_time,windows,enabled,last_action_at,last_error,created_at,schedule_status from stores where id=$1",
      [r.rows[0].id],
    );
    return NextResponse.json({ store: ready.rows[0] }, { status: 201 });
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
