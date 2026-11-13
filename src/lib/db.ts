import { Pool } from "pg";

const globalForPg = globalThis as unknown as { pool?: Pool };
export const pool =
  globalForPg.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === "disable"
        ? false
        : process.env.DATABASE_SSL === "require"
          ? { rejectUnauthorized: true }
          : undefined,
    max: 4,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 5_000,
  });
if (process.env.NODE_ENV !== "production") globalForPg.pool = pool;

export function requireDatabase() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is not configured");
}
