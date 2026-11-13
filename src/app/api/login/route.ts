import { NextResponse } from "next/server";
import { checkPassword, setSession } from "@/lib/security";
export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== "string" || !checkPassword(password))
    return NextResponse.json({ error: "登录信息无效" }, { status: 401 });
  await setSession();
  return NextResponse.json({ ok: true });
}
