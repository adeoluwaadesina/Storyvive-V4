import pg from "pg";
import { USERS_SCHEMA_SQL } from "../src/canon/users-schema.js";
import { STORY_SCHEMA_SQL } from "../src/story/schema.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL not set");
    const local = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
    pool = new Pool({
      connectionString,
      ssl: local ? false : { rejectUnauthorized: false },
      max: 4,
    });
  }
  return pool;
}

let schemaEnsured: Promise<void> | null = null;

/** Idempotent; safe to call on every request, cached per server process. */
export function ensureAppSchema(): Promise<void> {
  if (!schemaEnsured) {
    schemaEnsured = (async () => {
      await getPool().query(USERS_SCHEMA_SQL);
      await getPool().query(STORY_SCHEMA_SQL); // depends on users existing (FK), run second
    })();
  }
  return schemaEnsured;
}
