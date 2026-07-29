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
import { fetchPageRevision, fetchWikitext } from "./wikitext.js";
import { chunkEpisodes, chunkPlot, type CanonChunk, type ChunkSource } from "./chunk.js";
import { embedTexts, embedQuery, toPgVector, embeddingsEnabled } from "./embed.js";

const { Pool } = pg;

const PROVIDER = "wikipedia";
const FRESH_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Below this age, trust the cache without even checking Wikipedia's current
// revision — a daily background refresh (see /api/cron/refresh-canon) keeps
// popular titles inside this window, so most requests skip the revision
// round-trip entirely instead of paying for it on every hit.
const SOFT_FRESH_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

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

let schemaEnsured: Promise<void> | null = null;

/** Create tables/indexes if missing. Idempotent; memoized per process so it's
 *  cheap to call on every getCanon() rather than relying on callers to do it. */
export function ensureSchema(): Promise<void> {
  if (!schemaEnsured) {
    schemaEnsured = (async () => {
      const here = dirname(fileURLToPath(import.meta.url));
      const sql = await readFile(join(here, "schema.sql"), "utf8");
      await getPool().query(sql);
    })();
  }
  return schemaEnsured;
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
    `SELECT id, franchise, scope, season, episode, title, chunk_index, text, tokens_approx, source, trust_tier
       FROM canon_chunk WHERE index_id = $1
       ORDER BY season NULLS FIRST, episode NULLS FIRST, chunk_index`,
    [id],
  );
  return res.rows.map(rowToChunk);
}

function rowToChunk(r: {
  id: string;
  franchise: string;
  scope: CanonChunk["scope"];
  season: number | null;
  episode: number | null;
  title: string | null;
  chunk_index: number;
  text: string;
  tokens_approx: number;
  source: CanonChunk["source"];
  trust_tier: CanonChunk["trustTier"];
}): CanonChunk {
  return {
    id: r.id,
    franchise: r.franchise,
    scope: r.scope,
    season: r.season ?? undefined,
    episode: r.episode ?? undefined,
    title: r.title ?? undefined,
    chunkIndex: r.chunk_index,
    text: r.text,
    tokensApprox: r.tokens_approx,
    source: r.source,
    trustTier: r.trust_tier,
  };
}

/**
 * The last `n` chunks of a cached work, in canon order — i.e. its actual
 * ending. Used to seed a new story's continuity state from how the real
 * canon ended, rather than from whatever a prompt happens to sound similar to.
 */
export async function getFinalChunks(pageTitle: string, n = 8): Promise<CanonChunk[]> {
  const id = indexId(pageTitle);
  const res = await getPool().query(
    `SELECT id, franchise, scope, season, episode, title, chunk_index, text, tokens_approx, source, trust_tier
       FROM canon_chunk WHERE index_id = $1
       ORDER BY season DESC NULLS LAST, episode DESC NULLS LAST, chunk_index DESC
       LIMIT $2`,
    [id, n],
  );
  return res.rows.map(rowToChunk).reverse(); // chronological order
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
           (id, index_id, franchise, scope, season, episode, title, chunk_index, text, tokens_approx, source, trust_tier, embedding)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, id, c.franchise, c.scope, c.season ?? null, c.episode ?? null, c.title ?? null, c.chunkIndex, c.text, c.tokensApprox, c.source, c.trustTier, embeddings[i]],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Best-effort: snapshot raw wikitext for every distinct page these chunks
  // came from, for later audit. Not inside the transaction above — losing a
  // raw snapshot isn't worth rolling back a successful canon store over.
  const pages = [...new Set(chunks.map((c) => c.source.pageTitle).filter((p): p is string => Boolean(p)))];
  await Promise.all(
    pages.map(async (pageTitle) => {
      try {
        const wikitext = await fetchWikitext(pageTitle);
        await getPool().query(
          `INSERT INTO canon_raw (index_id, page_title, wikitext, fetched_at)
             VALUES ($1, $2, $3, now())
           ON CONFLICT (index_id, page_title) DO UPDATE SET
             wikitext = EXCLUDED.wikitext, fetched_at = now()`,
          [id, pageTitle, wikitext],
        );
      } catch (err) {
        console.warn(`storeRaw: failed to snapshot "${pageTitle}"`, err);
      }
    }),
  );
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
    `SELECT id, franchise, scope, season, episode, title, chunk_index, text, tokens_approx, source, trust_tier,
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
    chunkIndex: r.chunk_index,
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
  if (cacheEnabled()) await ensureSchema();
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
    const chunks = scope === "episode"
      ? chunkEpisodes((await getEpisodes(pageTitle!)).episodes, ctx)
      : chunkPlot(await getPlot(pageTitle!), ctx);
    // Not a fix for wiki-formatting drift, just a tripwire: a resolved TV
    // series with zero episode chunks (or a resolved page with zero plot
    // chunks) usually means a template shape we haven't handled yet, not
    // that the work genuinely has no canon text.
    if (chunks.length === 0) {
      console.warn(`getCanon: zero ${scope} chunks extracted for "${pageTitle}" — possible parser gap.`);
    }
    return chunks;
  };

  // No DB configured — just extract live.
  if (!cacheEnabled()) {
    return { pageTitle, type, scope, chunks: await extract(), cached: false };
  }

  const id = indexId(pageTitle);

  if (!opts?.force) {
    const row = await loadIndex(id);
    if (row) {
      // Recently (re)fetched — including by the background cron refresh —
      // so skip the Wikipedia revision round-trip entirely and just serve.
      if (Date.now() - row.fetched_at.getTime() < SOFT_FRESH_MS) {
        return { pageTitle, type, scope, chunks: await loadChunks(id), cached: true };
      }
      const rev = await fetchPageRevision(pageTitle);
      if (isFresh(row, rev.revisionId)) {
        return { pageTitle, type, scope, chunks: await loadChunks(id), cached: true };
      }
      const chunks = await extract(rev.revisionId);
      await store(id, { franchise: pageTitle, scope, pageTitle, pageId: rev.pageId, revisionId: rev.revisionId }, chunks);
      return { pageTitle, type, scope, chunks, cached: false };
    }
  }

  const rev = await fetchPageRevision(pageTitle);
  const chunks = await extract(rev.revisionId);
  await store(id, { franchise: pageTitle, scope, pageTitle, pageId: rev.pageId, revisionId: rev.revisionId }, chunks);
  return { pageTitle, type, scope, chunks, cached: false };
}

export type IndexSummary = {
  id: string;
  pageTitle: string;
  scope: "episode" | "page";
  franchise: string;
  fetchedAt: Date;
};

/** List every cached work, for the background refresh job. */
export async function listIndexes(): Promise<IndexSummary[]> {
  const res = await getPool().query(
    `SELECT id, page_title, scope, franchise, fetched_at FROM canon_index ORDER BY fetched_at ASC`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    pageTitle: r.page_title,
    scope: r.scope,
    franchise: r.franchise,
    fetchedAt: r.fetched_at,
  }));
}

/**
 * Re-extract and re-store a known page directly (no re-resolve — the cron
 * job already knows the exact page from canon_index), refreshing its
 * revision id, chunks, embeddings, and raw snapshot.
 */
export async function refreshPage(pageTitle: string, scope: "episode" | "page", franchise: string): Promise<void> {
  const id = indexId(pageTitle);
  const rev = await fetchPageRevision(pageTitle);
  const ctx: ChunkSource = { franchise, revisionId: rev.revisionId };
  const chunks = scope === "episode"
    ? chunkEpisodes((await getEpisodes(pageTitle)).episodes, ctx)
    : chunkPlot(await getPlot(pageTitle), ctx);
  await store(id, { franchise, scope, pageTitle, pageId: rev.pageId, revisionId: rev.revisionId }, chunks);
}
