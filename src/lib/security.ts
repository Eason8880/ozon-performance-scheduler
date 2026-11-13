import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
const secret = () => {
  const s = process.env.APP_SECRET;
  if (!s || Buffer.from(s, "base64").length !== 32)
    throw new Error("APP_SECRET must be a base64 encoded 32-byte key");
  return Buffer.from(s, "base64");
};
export function encrypt(value: string) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", secret(), iv);
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return [
    iv.toString("base64"),
    c.getAuthTag().toString("base64"),
    data.toString("base64"),
  ].join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value.split(".");
  const d = createDecipheriv(
    "aes-256-gcm",
    secret(),
    Buffer.from(iv, "base64"),
  );
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    d.update(Buffer.from(data, "base64")),
    d.final(),
  ]).toString("utf8");
}
const sign = (v: string) => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  return createHmac("sha256", secret).update(v).digest("base64url");
};
export type AccessGroup =
  "admin" | "oz1" | "oz2" | "oz3" | "oz4" | "oz5" | "ct";
export function checkPassword(p: string): AccessGroup | null {
  const groupPasswords: Record<Exclude<AccessGroup, "admin" | "ct">, string> = {
    oz1: process.env.OZ1_ADMIN_PASSWORD || "oz1",
    oz2: process.env.OZ2_ADMIN_PASSWORD || "oz2",
    oz3: process.env.OZ3_ADMIN_PASSWORD || "oz3",
    oz4: process.env.OZ4_ADMIN_PASSWORD || "oz4",
    oz5: process.env.OZ5_ADMIN_PASSWORD || "oz5",
  };
  const ctPassword = process.env.CT_ADMIN_PASSWORD || "";
  const candidates: [AccessGroup, string][] = [
    ["admin", process.env.ADMIN_PASSWORD || ""],
    ...(Object.entries(groupPasswords) as [
      Exclude<AccessGroup, "admin" | "ct">,
      string,
    ][]),
    ["ct", ctPassword],
  ];
  const matches: AccessGroup[] = [];
  for (const [group, expected] of candidates) {
    const a = Buffer.from(p),
      b = Buffer.from(expected);
    if (expected && a.length === b.length && timingSafeEqual(a, b))
      matches.push(group);
  }
  return matches.length === 1 ? matches[0] : null;
}
export async function setSession(group: AccessGroup = "admin") {
  const value = `${Date.now() + 7 * 86400000}.${group}`;
  (await cookies()).set("ozon_session", `${value}.${sign(value)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 604800,
  });
}
export function sessionGroupFromCookie(
  raw: string,
  now = Date.now(),
): AccessGroup | null {
  try {
    const separator = raw.lastIndexOf(".");
    if (separator < 1) return null;
    const payload = raw.slice(0, separator);
    const sig = raw.slice(separator + 1);
    const [v, role] = payload.split(".");
    const expiry = Number(v);
    if (
      !/^\d+$/.test(v) ||
      !Number.isSafeInteger(expiry) ||
      expiry <= now ||
      !sig ||
      (role !== undefined &&
        !["admin", "oz1", "oz2", "oz3", "oz4", "oz5", "ct"].includes(role))
    )
      return null;
    const expect = Buffer.from(sign(payload));
    const got = Buffer.from(sig);
    if (got.length !== expect.length || !timingSafeEqual(got, expect))
      return null;
    // Before groups were introduced, the signed payload contained only expiry.
    return (role ?? "admin") as AccessGroup;
  } catch {
    return null;
  }
}
export async function sessionGroup(): Promise<AccessGroup | null> {
  try {
    const raw = (await cookies()).get("ozon_session")?.value || "";
    return sessionGroupFromCookie(raw);
  } catch {
    return null;
  }
}
export async function authorized() {
  return (await sessionGroup()) !== null;
}
export async function clearSession() {
  (await cookies()).delete("ozon_session");
}
