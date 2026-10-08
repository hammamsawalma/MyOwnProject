import { drizzle, type PostgresJsDatabase, type PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { PgDatabase } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { requireEnv } from "@/config/env";
import * as schema from "./schema";

export type Schema = typeof schema;

/** Accepts both the root database and a transaction handle. */
export type Db = PgDatabase<PostgresJsQueryResultHKT, Schema>;

export interface DbHandle {
  db: PostgresJsDatabase<Schema>;
  close: () => Promise<void>;
}

export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  const client = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}

// Reuse one pool across Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { __studioDb?: DbHandle };

export function getDb(): PostgresJsDatabase<Schema> {
  if (!globalForDb.__studioDb) {
    globalForDb.__studioDb = createDb(requireEnv("DATABASE_URL"));
  }
  return globalForDb.__studioDb.db;
}
