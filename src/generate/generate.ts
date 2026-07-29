// Storyvive story generator. Resolves a work, ensures its canon is cached +
// embedded, retrieves the top-k chunks most relevant to the user prompt, then
// asks GPT-4o to write a story that stays inside those constraints.
//
// generateChapter() is continuity-aware: given a running StoryState and the
// previous chapter's text, it keeps a multi-chapter story consistent with
// itself instead of treating every call as a cold, one-shot request.

import OpenAI from "openai";
import { getCanon, retrieveChunks, type RetrievedChunk } from "../canon/cache.js";
import type { StoryState } from "./state.js";

const MODEL = "gpt-4o";
const RETRIEVE_K = 12;
const MAX_TOKENS = 8000;

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set — required for generation.");
    }
    client = new OpenAI();
  }
  return client;
}

export type Citation = {
  chunkId: string;
  scope: string;
  season?: number;
  episode?: number;
  title?: string;
  distance: number;
};

export type StoryResult = {
  work: string;
  pageTitle: string;
  prompt: string;
  story: string;
  citations: Citation[];
  usage: { inputTokens: number; outputTokens: number };
};

const SYSTEM_PROMPT = `You are Storyvive, a canon-faithful fiction writer. You will be given:
- The name of a work (a TV series, novel, film, etc.)
- A user's story prompt for this chapter
- A set of numbered CANON EXCERPTS drawn from that work's Wikipedia canon
- Optionally, a STORY STATE (what's currently true: who's alive, where things stand, unresolved threads) and the PREVIOUS CHAPTER already written

Canon rules:
1. Never contradict a fact stated in the excerpts or the STORY STATE (character deaths, plot events, relationships, timeline).
2. If the user's prompt asks for something that would contradict canon, honor the SPIRIT of the request by finding an in-canon way to achieve it, or by clearly framing it as an alternate scenario.
3. Ground concrete details (names, places, technologies, relationships) in what the excerpts show. Don't invent lore that already has canon coverage.
4. Cite the excerpts you leaned on by their number, inline, like [3] or [3,7]. Cite when a detail comes directly from an excerpt; do not cite for common-sense or user-supplied details.
5. If a PREVIOUS CHAPTER is given, continue directly from it — same characters' current state, same location/timeline unless the prompt moves them, no re-introducing things already established.

Craft rules — write like a skilled novelist, not a summary:
6. Show, don't tell: render moments through action, dialogue, and sensory detail instead of stating emotions or outcomes outright.
7. Vary sentence rhythm — mix short punches with longer flowing sentences. Avoid repetitive openers and generic AI-fiction phrasing ("little did they know", "as if to", "in that moment").
8. Ground scenes in concrete sensory detail (sound, light, texture, temperature) rather than abstract description.
9. Aim for 600-1200 words unless the user specifies otherwise. Prose only — no meta-commentary, no headers, no "Here is a story:" preamble.`;

function formatExcerpts(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => {
      const loc = c.scope === "episode"
        ? `S${c.season ?? "?"}E${c.episode ?? "?"} "${c.title ?? "untitled"}"`
        : c.title ?? c.scope;
      return `[${i + 1}] (${loc})\n${c.text}`;
    })
    .join("\n\n");
}

function formatState(state: StoryState): string {
  const chars = state.characters.length
    ? state.characters.map((c) => `- ${c.name}: ${c.status ?? "unknown"}${c.location ? `, at ${c.location}` : ""}${c.notes ? ` (${c.notes})` : ""}`).join("\n")
    : "(none tracked yet)";
  const threads = state.unresolvedThreads.length ? state.unresolvedThreads.map((t) => `- ${t}`).join("\n") : "(none)";
  return [
    `Timeline: ${state.timelineMarker || "unknown"}`,
    `Last event: ${state.lastEventSummary || "(none)"}`,
    `Characters:\n${chars}`,
    `Unresolved threads:\n${threads}`,
  ].join("\n");
}

export type GenerateChapterOptions = {
  work: string;
  prompt: string;
  /** Running continuity state; omit for a cold, stateless one-shot. */
  state?: StoryState;
  /** The immediately preceding chapter's text, if continuing a story. */
  previousChapterText?: string;
};

export async function generateChapter(opts: GenerateChapterOptions): Promise<StoryResult> {
  const { work, prompt, state, previousChapterText } = opts;

  // 1. Resolve + ensure the work's canon is cached and embedded.
  const canon = await getCanon(work);
  if (canon.chunks.length === 0) {
    throw new Error(`No canon chunks available for "${work}" (resolved to "${canon.pageTitle}").`);
  }

  // 2. Retrieve top-k chunks most relevant to the prompt.
  const chunks = await retrieveChunks(prompt, canon.pageTitle, RETRIEVE_K);
  if (chunks.length === 0) {
    throw new Error(
      `No chunks matched the prompt for "${canon.pageTitle}" — the cache may not have embeddings yet. ` +
      `Try re-running --cache with OPENAI_API_KEY set.`,
    );
  }

  // 3. Compose the user turn and call the writer model.
  const parts = [`WORK: ${canon.pageTitle}`, ``];
  if (state) {
    parts.push(`STORY STATE:`, formatState(state), ``);
  }
  if (previousChapterText) {
    parts.push(`PREVIOUS CHAPTER:`, previousChapterText, ``);
  }
  parts.push(`USER PROMPT: ${prompt}`, ``, `CANON EXCERPTS:`, formatExcerpts(chunks));
  const userTurn = parts.join("\n");

  const res = await getClient().chat.completions.create({
    model: MODEL,
    max_completion_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userTurn },
    ],
  });

  const story = (res.choices[0]?.message?.content ?? "").trim();

  const citations: Citation[] = chunks.map((c) => ({
    chunkId: c.id,
    scope: c.scope,
    season: c.season,
    episode: c.episode,
    title: c.title,
    distance: c.distance,
  }));

  return {
    work,
    pageTitle: canon.pageTitle,
    prompt,
    story,
    citations,
    usage: {
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
    },
  };
}

/** Cold, stateless one-shot — kept for the CLI harness (test-canon.ts --generate). */
export async function generateStory(opts: { work: string; prompt: string }): Promise<StoryResult> {
  return generateChapter(opts);
}
