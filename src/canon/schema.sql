-- Storyvive canon cache schema (handover Section 9). Idempotent; safe to re-run.
-- One row per cached work in canon_index, its chunks in canon_chunk.

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

CREATE INDEX IF NOT EXISTS canon_chunk_index_id_idx ON canon_chunk (index_id);
CREATE INDEX IF NOT EXISTS canon_index_lookup_idx ON canon_index (provider, page_title);
