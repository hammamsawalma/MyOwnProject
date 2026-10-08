import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Recreates the test schema from the migrations before the integration run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/studio_test";
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`select 1`;
  } catch (err) {
    await sql.end();
    throw new Error(`Test database unreachable at ${url}. Run "pnpm db:start" first.\n${String(err)}`);
  }
  await sql.unsafe("drop schema if exists drizzle cascade; drop schema public cascade; create schema public;");
  await migrate(drizzle(sql), { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  await sql.end();
  await rm(path.join(os.tmpdir(), "studio-web-test-storage"), { recursive: true, force: true });
}
