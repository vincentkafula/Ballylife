import { newDb, type IMemoryDb } from "pg-mem";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Builds a fresh in-memory, Postgres-compatible database (via pg-mem)
 * with the real schema.sql applied, and returns a `pg`-compatible Pool
 * pointed at it. Used by integration tests to exercise actual route
 * handlers against something that behaves like the real database,
 * without needing a live Postgres instance for CI or local runs.
 *
 * Known gap: `CREATE EXTENSION pgcrypto` isn't supported by pg-mem, so
 * it's stripped before loading, and gen_random_uuid() is registered
 * manually below using Node's own crypto.randomUUID() instead — same
 * output shape, not the actual pgcrypto implementation. Everything else
 * in schema.sql (JSONB, ->> operators, ON CONFLICT, joins, transactions)
 * has been verified to work against pg-mem for this schema.
 */
export function createTestDb(): { db: IMemoryDb; pool: InstanceType<ReturnType<IMemoryDb["adapters"]["createPg"]>["Pool"]> } {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({ name: "gen_random_uuid", returns: "uuid" as never, implementation: () => randomUUID(), impure: true });

  let schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
  schema = schema.replace(/CREATE EXTENSION[^;]*;/gi, "");
  db.public.none(schema);

  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  return { db, pool };
}
