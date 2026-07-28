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
export function ensureUsersSchema(): Promise<void> {
  if (!schemaEnsured) {
    schemaEnsured = (async () => {
      const sql = await readFile(path.join(process.cwd(), "src/canon/users.sql"), "utf8");
      await getPool().query(sql);
    })();
  }
  return schemaEnsured;
}
