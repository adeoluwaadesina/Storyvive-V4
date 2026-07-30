import { getPool, ensureAppSchema } from "./db.js";
import { EMPTY_STATE, type StoryState } from "../src/generate/state.js";

export { EMPTY_STATE, type StoryState };

export type Story = {
  id: string;
  userId: string;
  work: string;
  title: string;
  genre: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type StoryChapter = {
  id: string;
  storyId: string;
  chapterIndex: number;
  title: string;
  userPrompt: string;
  content: string;
  citations: unknown[];
  /** Story state as it stood before this chapter was generated — what the
   *  reading UI shows, so it never spoils this chapter's own events. */
  stateBefore: StoryState;
  /** Story state once this chapter is folded in — the diff against
   *  stateBefore drives the state-map animation when a new chapter lands. */
  stateAfter: StoryState;
  createdAt: string;
};

const STORY_COLUMNS = "id, user_id, work, title, genre, status, created_at, updated_at";

export async function createStory(userId: string, work: string, title: string, genre = ""): Promise<Story> {
  await ensureAppSchema();
  const res = await getPool().query(
    `INSERT INTO stories (user_id, work, title, genre) VALUES ($1, $2, $3, $4)
     RETURNING ${STORY_COLUMNS}`,
    [userId, work, title, genre],
  );
  return toStory(res.rows[0]);
}

export async function getStory(storyId: string, userId: string): Promise<Story | null> {
  await ensureAppSchema();
  const res = await getPool().query(
    `SELECT ${STORY_COLUMNS} FROM stories WHERE id = $1 AND user_id = $2`,
    [storyId, userId],
  );
  return res.rows[0] ? toStory(res.rows[0]) : null;
}

export async function listStories(userId: string): Promise<Story[]> {
  await ensureAppSchema();
  const res = await getPool().query(
    `SELECT ${STORY_COLUMNS} FROM stories WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId],
  );
  return res.rows.map(toStory);
}

export async function touchStory(storyId: string): Promise<void> {
  await getPool().query(`UPDATE stories SET updated_at = now() WHERE id = $1`, [storyId]);
}

const CHAPTER_COLUMNS =
  "id, story_id, chapter_index, title, user_prompt, content, citations, state_before, state_after, created_at";

export async function getChapters(storyId: string): Promise<StoryChapter[]> {
  const res = await getPool().query(
    `SELECT ${CHAPTER_COLUMNS} FROM story_chapters WHERE story_id = $1 ORDER BY chapter_index ASC`,
    [storyId],
  );
  return res.rows.map(toChapter);
}

export async function getLastChapter(storyId: string): Promise<StoryChapter | null> {
  const res = await getPool().query(
    `SELECT ${CHAPTER_COLUMNS} FROM story_chapters WHERE story_id = $1 ORDER BY chapter_index DESC LIMIT 1`,
    [storyId],
  );
  return res.rows[0] ? toChapter(res.rows[0]) : null;
}

export async function addChapter(
  storyId: string,
  chapterIndex: number,
  title: string,
  userPrompt: string,
  content: string,
  citations: unknown[],
  stateBefore: StoryState,
  stateAfter: StoryState,
): Promise<StoryChapter> {
  const res = await getPool().query(
    `INSERT INTO story_chapters
       (story_id, chapter_index, title, user_prompt, content, citations, state_before, state_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${CHAPTER_COLUMNS}`,
    [
      storyId,
      chapterIndex,
      title,
      userPrompt,
      content,
      JSON.stringify(citations),
      JSON.stringify(stateBefore),
      JSON.stringify(stateAfter),
    ],
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
  genre: string;
  status: string;
  created_at: string;
  updated_at: string;
}): Story {
  return {
    id: row.id,
    userId: row.user_id,
    work: row.work,
    title: row.title,
    genre: row.genre ?? "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toChapter(row: {
  id: string;
  story_id: string;
  chapter_index: number;
  title: string;
  user_prompt: string;
  content: string;
  citations: unknown[];
  state_before: StoryState | null;
  state_after: StoryState | null;
  created_at: string;
}): StoryChapter {
  return {
    id: row.id,
    storyId: row.story_id,
    chapterIndex: row.chapter_index,
    title: row.title ?? "",
    userPrompt: row.user_prompt,
    content: row.content,
    citations: row.citations ?? [],
    stateBefore: row.state_before ?? EMPTY_STATE,
    stateAfter: row.state_after ?? EMPTY_STATE,
    createdAt: row.created_at,
  };
}
