import { NextResponse } from "next/server";
import { checkPassword, setSession } from "@/lib/security";
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const password = body && typeof body === "object" ? body.password : undefined;
  const group = typeof password === "string" ? checkPassword(password) : null;
  if (!group)
    return NextResponse.json({ error: "登录信息无效" }, { status: 401 });
  await setSession(group);
  return NextResponse.json({ ok: true, group });
}
