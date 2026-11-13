import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { sessionGroup } from "@/lib/security";
import {
  canReadStoreLogs,
  decodeActionRunCursor,
  pageActionRuns,
  type ActionRunRow,
} from "@/lib/action-runs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const group = await sessionGroup();
  if (!group) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    return NextResponse.json({ error: "店铺不存在" }, { status: 404 });

  const url = new URL(request.url);
  const cursorValue = url.searchParams.get("cursor");
  const cursor = cursorValue ? decodeActionRunCursor(cursorValue) : null;
  if (cursorValue && !cursor)
    return NextResponse.json({ error: "分页游标无效" }, { status: 400 });

  try {
    const owner = await pool.query<{ owner_group: string | null }>(
      "select owner_group from stores where id=$1",
      [id],
    );
    if (!owner.rowCount || !canReadStoreLogs(group, owner.rows[0].owner_group))
      return NextResponse.json({ error: "店铺不存在" }, { status: 404 });

    const runs = await pool.query<ActionRunRow>(
      `select id::text as id, action_key,action,status,detail,source,
         to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
       from job_runs
       where store_id=$1
         and ($2::timestamptz is null or (created_at,id)<($2::timestamptz,$3::bigint))
       order by created_at desc,id desc limit 6`,
      [id, cursor?.createdAt ?? null, cursor?.id ?? null],
    );
    return NextResponse.json(pageActionRuns(runs.rows));
  } catch {
    return NextResponse.json({ error: "读取执行记录失败" }, { status: 503 });
  }
}
