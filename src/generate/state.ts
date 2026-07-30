// Story continuity state — a lightweight "knowledge graph" substitute: not a
// graph database, just a small structured record of what's true right now
// (who's alive, where they are, what's unresolved, what just happened). This
// is what lets chapter N+1 stay consistent with chapter N, and what lets a
// brand-new story pick up genuinely from how the real canon ended rather
// than from whatever chunk happens to sound similar to the prompt.
//
// Kept cheap on purpose: uses gpt-4o-mini with a small JSON output, not the
// gpt-4o writer model — this runs once per chapter (twice for chapter 1) and
// shouldn't meaningfully add to token cost.

import OpenAI from "openai";
import { getFinalChunks } from "../canon/cache.js";
import type { CanonChunk } from "../canon/chunk.js";
import { formatEpisodeLocation, formatAirDate } from "./format.js";

const UTILITY_MODEL = "gpt-4o-mini";

export type StoryState = {
  characters: Array<{ name: string; status?: string; location?: string; notes?: string }>;
  unresolvedThreads: string[];
  lastEventSummary: string;
  timelineMarker: string;
};

export const EMPTY_STATE: StoryState = {
  characters: [],
  unresolvedThreads: [],
  lastEventSummary: "",
  timelineMarker: "",
};

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
    client = new OpenAI();
  }
  return client;
}

const STATE_SCHEMA_HINT = `Respond with ONLY a JSON object of this exact shape, no prose:
{
  "characters": [{"name": string, "status": string, "location": string, "notes": string}],
  "unresolvedThreads": [string],
  "lastEventSummary": string,
  "timelineMarker": string
}
"status" is short, e.g. "alive", "dead", "missing", "unknown". Keep "characters" to the
significant ones only (max ~10). "unresolvedThreads" are open plot threads, max ~6.
"lastEventSummary" is 1-3 sentences on what just happened. "timelineMarker" is a short
phrase locating where we are, e.g. "immediately after the season 1 finale".`;

function formatChunks(chunks: CanonChunk[]): string {
  return chunks
    .map((c) => {
      const airDate = formatAirDate(c.source.airDate);
      const loc = c.scope === "episode"
        ? `${formatEpisodeLocation(c)} "${c.title ?? "untitled"}"${airDate ? ` (aired ${airDate})` : ""}`
        : c.title ?? c.scope;
      return `(${loc})\n${c.text}`;
    })
    .join("\n\n");
}

async function askForState(userTurn: string): Promise<StoryState> {
  const res = await getClient().chat.completions.create({
    model: UTILITY_MODEL,
    max_completion_tokens: 800,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `You track story continuity state. ${STATE_SCHEMA_HINT}` },
      { role: "user", content: userTurn },
    ],
  });
  const raw = res.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw);
    return {
      characters: Array.isArray(parsed.characters) ? parsed.characters : [],
      unresolvedThreads: Array.isArray(parsed.unresolvedThreads) ? parsed.unresolvedThreads : [],
      lastEventSummary: typeof parsed.lastEventSummary === "string" ? parsed.lastEventSummary : "",
      timelineMarker: typeof parsed.timelineMarker === "string" ? parsed.timelineMarker : "",
    };
  } catch {
    return EMPTY_STATE;
  }
}

/**
 * Seed a new story's state from how the real canon actually ended — the
 * work's final chunks in canon order, not a prompt-similarity search. This is
 * what makes "continue the show from where it left off" start from a real
 * ending instead of a guess.
 */
export async function seedStateFromCanon(pageTitle: string): Promise<StoryState> {
  const finalChunks = await getFinalChunks(pageTitle, 8);
  if (finalChunks.length === 0) return EMPTY_STATE;
  const userTurn = [
    `WORK: ${pageTitle}`,
    ``,
    `Here are the final known canon excerpts for this work, in order:`,
    formatChunks(finalChunks),
    ``,
    `Summarize the state of the story as of this ending.`,
  ].join("\n");
  return askForState(userTurn);
}

/**
 * Fold a newly generated chapter into the running state.
 */
export async function updateState(prev: StoryState, chapterPrompt: string, chapterText: string): Promise<StoryState> {
  const userTurn = [
    `PREVIOUS STATE:`,
    JSON.stringify(prev, null, 2),
    ``,
    `THE USER ASKED FOR: ${chapterPrompt || "(nothing specific — the chapter continued naturally)"}`,
    ``,
    `THE CHAPTER THAT WAS JUST WRITTEN:`,
    chapterText,
    ``,
    `Update the state to reflect what's true after this chapter.`,
  ].join("\n");
  return askForState(userTurn);
}
