import pg from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";

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
      const usersSql = await readFile(path.join(process.cwd(), "src/canon/users.sql"), "utf8");
      const storySql = await readFile(path.join(process.cwd(), "src/story/schema.sql"), "utf8");
      await getPool().query(usersSql);
      await getPool().query(storySql); // depends on users existing (FK), run second
    })();
  }
  return schemaEnsured;
}
