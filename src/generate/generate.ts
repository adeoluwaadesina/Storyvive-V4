// Storyvive story generator. Resolves a work, ensures its canon is cached +
// embedded, retrieves the top-k chunks most relevant to the user prompt, then
// asks GPT-4o to write a story that stays inside those constraints.

import OpenAI from "openai";
import { getCanon, retrieveChunks, type RetrievedChunk } from "../canon/cache.js";

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

const SYSTEM_PROMPT = `You are Storyvive, a canon-faithful fan-fiction writer. You will be given:
- The name of a work (a TV series, novel, film, etc.)
- A user's story prompt
- A set of numbered CANON EXCERPTS drawn from that work's Wikipedia canon.

Your job is to write a story that satisfies the user's prompt while remaining consistent with the canon excerpts. Rules:
1. Never contradict a fact stated in the excerpts (character deaths, plot events, relationships, timeline).
2. If the user's prompt asks for something that would contradict canon, honor the SPIRIT of the request by finding an in-canon way to achieve it, or by clearly framing it as an alternate scenario.
3. Ground concrete details (names, places, technologies, relationships) in what the excerpts show. Don't invent lore that already has canon coverage.
4. Cite the excerpts you leaned on by their number, inline, like [3] or [3,7]. Cite when a detail comes directly from an excerpt; do not cite for common-sense or user-supplied details.
5. Aim for 600-1200 words unless the user specifies otherwise. Prose only — no meta-commentary, no headers, no "Here is a story:" preamble.`;

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

export type GenerateOptions = { work: string; prompt: string };

export async function generateStory(opts: GenerateOptions): Promise<StoryResult> {
  const { work, prompt } = opts;

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

  // 3. Compose the user turn and call Opus.
  const userTurn = [
    `WORK: ${canon.pageTitle}`,
    ``,
    `USER PROMPT: ${prompt}`,
    ``,
    `CANON EXCERPTS:`,
    formatExcerpts(chunks),
  ].join("\n");

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
