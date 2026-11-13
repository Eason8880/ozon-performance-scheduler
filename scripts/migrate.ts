import { readFile } from "node:fs/promises";
import { pool } from "../src/lib/db";

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required to run migrations");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())",
    );
    let applied = 0;
    for (const version of [
      "001_initial",
      "002_event_schedules",
      "003_job_run_source",
      "004_store_groups",
    ]) {
      const already = await client.query(
        "select 1 from schema_migrations where version=$1",
        [version],
      );
      if (already.rowCount) continue;
      const sql = await readFile(
        new URL(`../migrations/${version}.sql`, import.meta.url),
        "utf8",
      );
      await client.query(sql);
      await client.query("insert into schema_migrations(version) values($1)", [
        version,
      ]);
      process.stdout.write(`Applied ${version}.\n`);
      applied++;
    }
    await client.query("commit");
    if (applied === 0) process.stdout.write("No pending migrations.\n");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(
    error instanceof Error ? `${error.message}\n` : "Migration failed.\n",
  );
  process.exitCode = 1;
});
