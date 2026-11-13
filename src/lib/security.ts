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
export function checkPassword(p: string) {
  const expected = process.env.ADMIN_PASSWORD || "";
  const a = Buffer.from(p),
    b = Buffer.from(expected);
  return !!expected && a.length === b.length && timingSafeEqual(a, b);
}
export async function setSession() {
  const value = `${Date.now() + 7 * 86400000}`;
  (await cookies()).set("ozon_session", `${value}.${sign(value)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 604800,
  });
}
export async function authorized() {
  try {
    const raw = (await cookies()).get("ozon_session")?.value || "";
    const parts = raw.split(".");
    if (parts.length !== 2) return false;
    const [v, sig] = parts;
    const expiry = Number(v);
    if (
      !/^\d+$/.test(v) ||
      !Number.isSafeInteger(expiry) ||
      expiry <= Date.now() ||
      !sig
    )
      return false;
    const expect = Buffer.from(sign(v));
    const got = Buffer.from(sig);
    return got.length === expect.length && timingSafeEqual(got, expect);
  } catch {
    return false;
  }
}
export async function clearSession() {
  (await cookies()).delete("ozon_session");
}
