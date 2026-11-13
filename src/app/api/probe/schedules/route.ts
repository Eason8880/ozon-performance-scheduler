import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Schedules } from "@vercel/schedules";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (
    process.env.VERCEL_ENV !== "preview" ||
    !process.env.SCHEDULE_PROBE_SECRET ||
    request.headers.get("authorization") !==
      `Bearer ${process.env.SCHEDULE_PROBE_SECRET}`
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const name = `probe-${randomUUID()}`;
  try {
    await Schedules.create({
      name,
      target: { topic: "ozon-promo-edge" },
      expression: { type: "cron", cron: "* * * * *" },
      timezone: "UTC",
      payload: { dryRun: true },
    });
    await Schedules.invoke({ name });
    await Schedules.delete({ name });
    return NextResponse.json({ created: true, invoked: true, deleted: true });
  } catch {
    await Schedules.delete({ name }).catch(() => undefined);
    return NextResponse.json(
      { error: "Schedule or queue probe failed" },
      { status: 503 },
    );
  }
}
