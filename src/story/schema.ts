// Storyvive story persistence + continuity state. Idempotent; safe to re-run.
// A "story" is one user's ongoing generation against one work; chapters are
// its generated content in order; story_state is the running "what's true
// right now" summary that keeps chapter N+1 consistent with chapter N (and,
// for chapter 1, consistent with how the real canon actually ended).
// Embedded as a string, not a .sql file read at runtime — see canon/schema.ts for why.

export const STORY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS stories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work       text NOT NULL,               -- resolved canon page title
  title      text NOT NULL,
  status     text NOT NULL DEFAULT 'ongoing',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS story_chapters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id      uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  chapter_index integer NOT NULL,
  user_prompt   text NOT NULL,
  content       text NOT NULL,
  citations     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (story_id, chapter_index)
);

-- One row per story: characters/threads/timeline as of the latest chapter
-- (or, before any user chapter exists, as of the end of known canon).
CREATE TABLE IF NOT EXISTS story_state (
  story_id           uuid PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
  characters         jsonb NOT NULL DEFAULT '[]'::jsonb,
  unresolved_threads jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_event_summary text NOT NULL DEFAULT '',
  timeline_marker    text NOT NULL DEFAULT '',
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stories_user_id_idx ON stories (user_id);
CREATE INDEX IF NOT EXISTS story_chapters_story_id_idx ON story_chapters (story_id);
`;
