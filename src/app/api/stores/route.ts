import { NextResponse } from "next/server";
import { sessionGroup, encrypt } from "@/lib/security";
import { checkCredentials } from "@/lib/ozon";
import { pool } from "@/lib/db";
import { syncStoreSchedules } from "@/lib/store-schedules";
import { pageActionRuns, type ActionRunRow } from "@/lib/action-runs";
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
        error: "还没有连接数据库，请先设置 DATABASE_URL。",
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
       coalesce(logs.rows, '[]'::json) as run_rows
       from stores s
       left join lateral (
         select json_agg(x) as rows from (
           select j.id::text as id, j.action_key,j.action,j.status,j.detail,j.source,
             to_char(j.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
           from job_runs j where j.store_id=s.id
           order by j.created_at desc,j.id desc limit 6
         ) x
       ) logs on true
       where $1='admin' or s.owner_group=$1 order by s.created_at`,
      [group],
    );
    const stores = r.rows.map(({ run_rows, ...store }) => {
      const page = pageActionRuns((run_rows ?? []) as ActionRunRow[]);
      return {
        ...store,
        runs: page.items,
        runsHasMore: page.hasMore,
        runsNextCursor: page.nextCursor,
      };
    });
    return NextResponse.json({ stores, group });
  } catch (e) {
    return NextResponse.json(
      { error: "店铺列表没有读取成功，数据库连接失败。请检查 DATABASE_URL 后刷新。" },
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
      { error: "请填写店铺名称、Client ID 和 Client Secret。" },
      { status: 400 },
    );
  if (!validateWindows(windowsInput))
    return NextResponse.json(
      { error: "时段设置有问题：至少要有 1 个、最多 8 个时段，开启和关闭时间不能相同，时段之间不能重叠。" },
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
          error: "店铺已添加，但定时任务没有创建成功。请在店铺卡片上点击「重试」。",
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
            ? `Ozon 没有接受这组密钥（错误码 ${e.message.match(/\((\d+)\)/)?.[1] ?? "未知"}）。请确认填的是 Performance API 的 Client ID 和 Client Secret，且没有多余空格。`
            : "店铺没有添加成功，请稍后重试。",
      },
      { status: 503 },
    );
  }
}
