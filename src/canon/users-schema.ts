// Storyvive users + usage tracking. Idempotent; safe to re-run.
// Kept separate from canon schema since it's an unrelated concern.
// Embedded as a string, not a .sql file read at runtime — see schema.ts for why.

export const USERS_SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text UNIQUE NOT NULL,
  password_hash    text,                 -- null once a Google-only account exists later
  generations_used integer NOT NULL DEFAULT 0,
  generation_limit integer NOT NULL DEFAULT 10,
  created_at       timestamptz NOT NULL DEFAULT now()
);
`;
