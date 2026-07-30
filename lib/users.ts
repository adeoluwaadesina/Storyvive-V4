import bcrypt from "bcryptjs";
import { getPool, ensureAppSchema } from "./db.js";

export type User = {
  id: string;
  email: string;
  generationsUsed: number;
  generationLimit: number;
};

export async function createUser(email: string, password: string): Promise<User> {
  await ensureAppSchema();
  const passwordHash = await bcrypt.hash(password, 10);
  const res = await getPool().query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     RETURNING id, email, generations_used, generation_limit`,
    [email.toLowerCase().trim(), passwordHash],
  );
  return toUser(res.rows[0]);
}

export async function verifyUser(email: string, password: string): Promise<User | null> {
  await ensureAppSchema();
  const res = await getPool().query(
    `SELECT id, email, password_hash, generations_used, generation_limit FROM users WHERE email = $1`,
    [email.toLowerCase().trim()],
  );
  const row = res.rows[0];
  if (!row || !row.password_hash) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  return ok ? toUser(row) : null;
}

export async function getUserById(id: string): Promise<User | null> {
  await ensureAppSchema();
  const res = await getPool().query(
    `SELECT id, email, generations_used, generation_limit FROM users WHERE id = $1`,
    [id],
  );
  return res.rows[0] ? toUser(res.rows[0]) : null;
}

/**
 * Atomically claim one generation slot. Returns the updated user if the
 * limit hadn't been reached, or null if the caller is already at/over limit
 * (no row is updated in that case, so nothing is double-spent).
 */
export async function claimGeneration(id: string): Promise<User | null> {
  await ensureAppSchema();
  const res = await getPool().query(
    `UPDATE users SET generations_used = generations_used + 1
       WHERE id = $1 AND generations_used < generation_limit
     RETURNING id, email, generations_used, generation_limit`,
    [id],
  );
  return res.rows[0] ? toUser(res.rows[0]) : null;
}

/** Give back a slot claimed by claimGeneration() when the generation itself failed. */
export async function refundGeneration(id: string): Promise<void> {
  await getPool().query(
    `UPDATE users SET generations_used = GREATEST(generations_used - 1, 0) WHERE id = $1`,
    [id],
  );
}

function toUser(row: {
  id: string;
  email: string;
  generations_used: number;
  generation_limit: number;
}): User {
  return {
    id: row.id,
    email: row.email,
    generationsUsed: row.generations_used,
    generationLimit: row.generation_limit,
  };
}
