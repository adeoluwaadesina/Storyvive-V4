import { getPool, ensureAppSchema } from "./db.js";
import { EMPTY_STATE, type StoryState } from "../src/generate/state.js";

export { EMPTY_STATE, type StoryState };

export type Story = {
  id: string;
  userId: string;
  work: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type StoryChapter = {
  id: string;
  storyId: string;
  chapterIndex: number;
  userPrompt: string;
  content: string;
  citations: unknown[];
  createdAt: string;
};

export async function createStory(userId: string, work: string, title: string): Promise<Story> {
  await ensureAppSchema();
  const res = await getPool().query(
    `INSERT INTO stories (user_id, work, title) VALUES ($1, $2, $3)
     RETURNING id, user_id, work, title, status, created_at, updated_at`,
    [userId, work, title],
  );
  return toStory(res.rows[0]);
}

export async function getStory(storyId: string, userId: string): Promise<Story | null> {
  await ensureAppSchema();
  const res = await getPool().query(
    `SELECT id, user_id, work, title, status, created_at, updated_at
       FROM stories WHERE id = $1 AND user_id = $2`,
    [storyId, userId],
  );
  return res.rows[0] ? toStory(res.rows[0]) : null;
}

export async function listStories(userId: string): Promise<Story[]> {
  await ensureAppSchema();
  const res = await getPool().query(
    `SELECT id, user_id, work, title, status, created_at, updated_at
       FROM stories WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId],
  );
  return res.rows.map(toStory);
}

export async function touchStory(storyId: string): Promise<void> {
  await getPool().query(`UPDATE stories SET updated_at = now() WHERE id = $1`, [storyId]);
}

export async function getChapters(storyId: string): Promise<StoryChapter[]> {
  const res = await getPool().query(
    `SELECT id, story_id, chapter_index, user_prompt, content, citations, created_at
       FROM story_chapters WHERE story_id = $1 ORDER BY chapter_index ASC`,
    [storyId],
  );
  return res.rows.map(toChapter);
}

export async function getLastChapter(storyId: string): Promise<StoryChapter | null> {
  const res = await getPool().query(
    `SELECT id, story_id, chapter_index, user_prompt, content, citations, created_at
       FROM story_chapters WHERE story_id = $1 ORDER BY chapter_index DESC LIMIT 1`,
    [storyId],
  );
  return res.rows[0] ? toChapter(res.rows[0]) : null;
}

export async function addChapter(
  storyId: string,
  chapterIndex: number,
  userPrompt: string,
  content: string,
  citations: unknown[],
): Promise<StoryChapter> {
  const res = await getPool().query(
    `INSERT INTO story_chapters (story_id, chapter_index, user_prompt, content, citations)
       VALUES ($1, $2, $3, $4, $5)
     RETURNING id, story_id, chapter_index, user_prompt, content, citations, created_at`,
    [storyId, chapterIndex, userPrompt, content, JSON.stringify(citations)],
  );
  await touchStory(storyId);
  return toChapter(res.rows[0]);
}

export async function getState(storyId: string): Promise<StoryState> {
  const res = await getPool().query(
    `SELECT characters, unresolved_threads, last_event_summary, timeline_marker
       FROM story_state WHERE story_id = $1`,
    [storyId],
  );
  const row = res.rows[0];
  if (!row) return EMPTY_STATE;
  return {
    characters: row.characters ?? [],
    unresolvedThreads: row.unresolved_threads ?? [],
    lastEventSummary: row.last_event_summary ?? "",
    timelineMarker: row.timeline_marker ?? "",
  };
}

export async function setState(storyId: string, state: StoryState): Promise<void> {
  await getPool().query(
    `INSERT INTO story_state (story_id, characters, unresolved_threads, last_event_summary, timeline_marker, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (story_id) DO UPDATE SET
       characters = EXCLUDED.characters,
       unresolved_threads = EXCLUDED.unresolved_threads,
       last_event_summary = EXCLUDED.last_event_summary,
       timeline_marker = EXCLUDED.timeline_marker,
       updated_at = now()`,
    [
      storyId,
      JSON.stringify(state.characters),
      JSON.stringify(state.unresolvedThreads),
      state.lastEventSummary,
      state.timelineMarker,
    ],
  );
}

function toStory(row: {
  id: string;
  user_id: string;
  work: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}): Story {
  return {
    id: row.id,
    userId: row.user_id,
    work: row.work,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toChapter(row: {
  id: string;
  story_id: string;
  chapter_index: number;
  user_prompt: string;
  content: string;
  citations: unknown[];
  created_at: string;
}): StoryChapter {
  return {
    id: row.id,
    storyId: row.story_id,
    chapterIndex: row.chapter_index,
    userPrompt: row.user_prompt,
    content: row.content,
    citations: row.citations ?? [],
    createdAt: row.created_at,
  };
}
