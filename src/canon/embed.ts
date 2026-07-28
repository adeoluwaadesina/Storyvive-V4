// OpenAI text-embedding-3-small embedder for canon chunks + query strings.
// 1536-dim vectors. Batched (100 per request), one retry on 429/5xx.

import OpenAI from "openai";

export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMS = 1536;
const BATCH_SIZE = 100;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set — required for embeddings.");
    }
    client = new OpenAI();
  }
  return client;
}

export function embeddingsEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const c = getClient();
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await c.embeddings.create({ model: EMBED_MODEL, input: texts });
      return res.data.map((d) => d.embedding);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (attempt < 2 && (status === 429 || (status !== undefined && status >= 500))) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("embedBatch: unreachable");
}

/** Embed many texts. Preserves input order. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    out.push(...(await embedBatch(batch)));
  }
  return out;
}

/** Embed a single string. */
export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedBatch([text]);
  return v;
}

/** Serialize a float array to pgvector's text format: "[0.1,0.2,...]". */
export function toPgVector(v: number[]): string {
  return `[${v.join(",")}]`;
}
