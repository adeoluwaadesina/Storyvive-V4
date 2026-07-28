// Neon-backed canon cache (handover task 10). Wraps the extractor pipeline:
// resolve -> (episodes | plot) -> chunk -> store, serving cached chunks when the
// page is fresh (< 30 days) AND its Wikipedia revision is unchanged.
//
// Needs DATABASE_URL (a Neon Postgres connection string). Until that env var is
// set the cache simply isn't used — the rest of the extractor runs fine without it.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { resolveTitle, type CandidateType } from "./resolve.js";
import { getEpisodes } from "./episodes.js";
import { getPlot } from "./plot.js";
import { fetchPageRevision } from "./wikitext.js";
import { chunkEpisodes, chunkPlot, type CanonChunk, type ChunkSource } from "./chunk.js";
import { embedTexts, embedQuery, toPgVector, embeddingsEnabled } from "./embed.js";

const { Pool } = pg;

const PROVIDER = "wikipedia";
const FRESH_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let pool: pg.Pool | null = null;

/** True when a Neon/Postgres connection string is configured. */
export function cacheEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL not set — required for the canon cache (Neon).");
    }
    const local = /@(localhost|127\.0\.0\.1)/.test(connectionString);
    pool = new Pool({
      connectionString,
      ssl: local ? false : { rejectUnauthorized: false },
      max: 4,
    });
  }
  return pool;
}

export async function closeCache(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Create tables/indexes if missing. Idempotent. */
export async function ensureSchema(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(join(here, "schema.sql"), "utf8");
  await getPool().query(sql);
}

function indexId(pageTitle: string): string {
  const key = `${PROVIDER}|${pageTitle}`.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

type IndexRow = {
  id: string;
  revision_id: string | null;
  fetched_at: Date;
};

async function loadIndex(id: string): Promise<IndexRow | null> {
  const res = await getPool().query<IndexRow>(
    "SELECT id, revision_id, fetched_at FROM canon_index WHERE id = $1",
    [id],
  );
  return res.rows[0] ?? null;
}

async function loadChunks(id: string): Promise<CanonChunk[]> {
  const res = await getPool().query(
    `SELECT id, franchise, scope, season, episode, title, text, tokens_approx, source, trust_tier
       FROM canon_chunk WHERE index_id = $1
       ORDER BY season NULLS FIRST, episode NULLS FIRST, id`,
    [id],
  );
  return res.rows.map((r) => ({
    id: r.id,
    franchise: r.franchise,
    scope: r.scope,
    season: r.season ?? undefined,
    episode: r.episode ?? undefined,
    title: r.title ?? undefined,
    text: r.text,
    tokensApprox: r.tokens_approx,
    source: r.source,
    trustTier: r.trust_tier,
  }));
}

async function store(
  id: string,
  meta: { franchise: string; scope: string; pageTitle: string; pageId?: number; revisionId?: number },
  chunks: CanonChunk[],
): Promise<void> {
  // Embed chunk text before the transaction — a slow embed API shouldn't
  // hold the DB connection open. Skip embedding when no OPENAI_API_KEY is set.
  let embeddings: (string | null)[] = chunks.map(() => null);
  if (embeddingsEnabled() && chunks.length > 0) {
    const vecs = await embedTexts(chunks.map((c) => c.text));
    embeddings = vecs.map(toPgVector);
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO canon_index (id, franchise, provider, scope, page_title, page_id, revision_id, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (id) DO UPDATE SET
         franchise = EXCLUDED.franchise,
         scope = EXCLUDED.scope,
         page_title = EXCLUDED.page_title,
         page_id = EXCLUDED.page_id,
         revision_id = EXCLUDED.revision_id,
         fetched_at = now()`,
      [id, meta.franchise, PROVIDER, meta.scope, meta.pageTitle, meta.pageId ?? null, meta.revisionId ?? null],
    );
    // Replace this work's chunks wholesale (stable ids mean unchanged chunks
    // simply reappear with the same id).
    await client.query("DELETE FROM canon_chunk WHERE index_id = $1", [id]);
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      await client.query(
        `INSERT INTO canon_chunk
           (id, index_id, franchise, scope, season, episode, title, text, tokens_approx, source, trust_tier, embedding)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, id, c.franchise, c.scope, c.season ?? null, c.episode ?? null, c.title ?? null, c.text, c.tokensApprox, c.source, c.trustTier, embeddings[i]],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export type RetrievedChunk = CanonChunk & { distance: number };

/**
 * Retrieve the top-k canon chunks most similar to `query` for a given franchise.
 * Requires DATABASE_URL + OPENAI_API_KEY. Returns [] when no chunks exist.
 */
export async function retrieveChunks(
  query: string,
  franchise: string,
  k = 8,
): Promise<RetrievedChunk[]> {
  if (!cacheEnabled()) throw new Error("retrieveChunks: DATABASE_URL not set");
  if (!embeddingsEnabled()) throw new Error("retrieveChunks: OPENAI_API_KEY not set");
  const qv = toPgVector(await embedQuery(query));
  const res = await getPool().query(
    `SELECT id, franchise, scope, season, episode, title, text, tokens_approx, source, trust_tier,
            embedding <=> $1::vector AS distance
       FROM canon_chunk
      WHERE franchise = $2 AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [qv, franchise, k],
  );
  return res.rows.map((r) => ({
    id: r.id,
    franchise: r.franchise,
    scope: r.scope,
    season: r.season ?? undefined,
    episode: r.episode ?? undefined,
    title: r.title ?? undefined,
    text: r.text,
    tokensApprox: r.tokens_approx,
    source: r.source,
    trustTier: r.trust_tier,
    distance: Number(r.distance),
  }));
}

function isFresh(row: IndexRow, currentRevisionId?: number): boolean {
  const ageOk = Date.now() - row.fetched_at.getTime() < FRESH_MS;
  // If we can read the current revision, require it to match; if not, fall back
  // to age only.
  const revOk =
    currentRevisionId === undefined ||
    row.revision_id === null ||
    String(row.revision_id) === String(currentRevisionId);
  return ageOk && revOk;
}

export type CanonResult = {
  pageTitle: string;
  type?: CandidateType;
  scope: "episode" | "page";
  chunks: CanonChunk[];
  cached: boolean;
};

/**
 * Get canon chunks for a title, using the cache when fresh. `force` bypasses the
 * cache and re-ingests. Falls back to a live (uncached) extraction when no
 * DATABASE_URL is configured.
 */
export async function getCanon(
  query: string,
  opts?: { preferType?: CandidateType; force?: boolean },
): Promise<CanonResult> {
  const resolved = await resolveTitle(query, opts?.preferType ? { preferType: opts.preferType } : undefined);
  let pageTitle: string | undefined;
  let type: CandidateType | undefined;
  if (resolved.status === "high") {
    pageTitle = resolved.chosen.pageTitle;
    type = resolved.chosen.type;
  } else if (resolved.status === "medium") {
    pageTitle = resolved.candidates[0]?.pageTitle;
    type = resolved.candidates[0]?.type;
  }
  if (!pageTitle) throw new Error(`could not resolve "${query}" (status: ${resolved.status})`);

  const scope: "episode" | "page" = type === "tv_series" ? "episode" : "page";

  const extract = async (revisionId?: number): Promise<CanonChunk[]> => {
    const ctx: ChunkSource = { franchise: pageTitle!, revisionId };
    if (scope === "episode") {
      const { episodes } = await getEpisodes(pageTitle!);
      return chunkEpisodes(episodes, ctx);
    }
    const plot = await getPlot(pageTitle!);
    return chunkPlot(plot, ctx);
  };

  // No DB configured — just extract live.
  if (!cacheEnabled()) {
    return { pageTitle, type, scope, chunks: await extract(), cached: false };
  }

  const id = indexId(pageTitle);
  const rev = await fetchPageRevision(pageTitle);

  if (!opts?.force) {
    const row = await loadIndex(id);
    if (row && isFresh(row, rev.revisionId)) {
      return { pageTitle, type, scope, chunks: await loadChunks(id), cached: true };
    }
  }

  const chunks = await extract(rev.revisionId);
  await store(id, { franchise: pageTitle, scope, pageTitle, pageId: rev.pageId, revisionId: rev.revisionId }, chunks);
  return { pageTitle, type, scope, chunks, cached: false };
}
