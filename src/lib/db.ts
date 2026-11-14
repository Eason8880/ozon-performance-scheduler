import { Pool, type PoolClient } from "pg";

function ssl() {
  return process.env.DATABASE_SSL === "disable"
    ? false
    : process.env.DATABASE_SSL === "require"
      ? { rejectUnauthorized: true }
      : undefined;
}

function createPool(connectionString: string | undefined) {
  return new Pool({
    connectionString,
    ssl: ssl(),
    max: 4,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 5_000,
  });
}

/**
 * Connection string for work that holds a per-store advisory lock.
 *
 * Session-level advisory locks belong to one server connection. Neon's pooled
 * endpoint (`-pooler` host) runs PgBouncer in transaction mode, so a lock and
 * its unlock can land on different server connections: the unlock silently
 * does nothing and the lock outlives the request. Locks therefore go through
 * the direct (unpooled) endpoint. Without one configured, e.g. a local
 * PostgreSQL that has no pooler, the main connection string is used.
 */
export function lockConnectionString(env: Record<string, string | undefined>) {
  return env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
}

const globalForPg = globalThis as unknown as { pool?: Pool; lockPool?: Pool };
export const pool = globalForPg.pool ?? createPool(process.env.DATABASE_URL);
/** Direct connections for code paths that take a per-store advisory lock. */
export const lockPool =
  globalForPg.lockPool ?? createPool(lockConnectionString(process.env));
if (process.env.NODE_ENV !== "production") {
  globalForPg.pool = pool;
  globalForPg.lockPool = lockPool;
}

/**
 * Release a store's advisory lock and return the client to its pool.
 * If the unlock fails or reports that nothing was released, the connection is
 * discarded instead of reused, which ends its session and frees any lock it
 * might still hold.
 */
export async function releaseStoreLock(client: PoolClient, storeId: string) {
  try {
    const result = await client.query(
      "select pg_advisory_unlock(hashtext($1)) as released",
      [storeId],
    );
    client.release(
      result.rows[0]?.released
        ? undefined
        : new Error("Store lock was not held by this connection"),
    );
  } catch (error) {
    client.release(error instanceof Error ? error : new Error("unlock failed"));
  }
}

export function requireDatabase() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is not configured");
}
