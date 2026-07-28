-- Storyvive canon cache schema (handover Section 9). Idempotent; safe to re-run.
-- One row per cached work in canon_index, its chunks in canon_chunk.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS canon_index (
  id           text PRIMARY KEY,             -- stable hash of provider + page_title
  franchise    text NOT NULL,
  provider     text NOT NULL,                -- 'wikipedia' | 'fandom' | 'internal'
  scope        text NOT NULL,                -- dominant scope: 'episode' | 'page' | ...
  page_title   text NOT NULL,
  page_id      integer,
  revision_id  bigint,                       -- latest revid at ingest, for freshness
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canon_chunk (
  id            text PRIMARY KEY,            -- stable content hash from chunk.ts
  index_id      text NOT NULL REFERENCES canon_index(id) ON DELETE CASCADE,
  franchise     text NOT NULL,
  scope         text NOT NULL,
  season        integer,
  episode       integer,
  title         text,
  text          text NOT NULL,
  tokens_approx integer NOT NULL,
  source        jsonb NOT NULL,
  trust_tier    text NOT NULL
);

-- Retrofit for tables created before the embedding column existed.
ALTER TABLE canon_chunk ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS canon_chunk_index_id_idx ON canon_chunk (index_id);
CREATE INDEX IF NOT EXISTS canon_index_lookup_idx ON canon_index (provider, page_title);
CREATE INDEX IF NOT EXISTS canon_chunk_franchise_idx ON canon_chunk (franchise);
-- ivfflat over cosine distance; small `lists` since a single work has ~10-500 chunks
CREATE INDEX IF NOT EXISTS canon_chunk_embedding_idx
  ON canon_chunk USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
