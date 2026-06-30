// Canon chunking + stable-hash dedup. Turns extracted canon (episode summaries,
// plot prose) into retrieval-sized CanonChunks the story generator can pull as
// constraints. Rules per handover Section 9: max ~1200 chars, split on
// paragraph then sentence boundaries, stable content-hash ids so re-ingesting the
// same canon de-dupes instead of piling up duplicates.
//
// No old ingest() TS exists in this repo (the V1-V3 codebase isn't here), so this
// is a clean rebuild from the documented chunk shape + rules.

import { createHash } from "node:crypto";
import type { Episode } from "./episodes.js";
import type { PlotResult } from "./plot.js";

export type CanonChunk = {
  id: string;
  franchise: string;
  scope: "episode" | "season" | "page" | "character";
  season?: number;
  episode?: number;
  title?: string;
  text: string;
  tokensApprox: number;
  source: {
    type: "internal" | "wikipedia" | "fandom";
    pageTitle?: string;
    url?: string;
    revisionId?: number;
  };
  trustTier: "primary" | "secondary";
};

export type ChunkSource = {
  /** Work name used to group chunks (e.g. "The Mandalorian"). */
  franchise: string;
  sourceType?: CanonChunk["source"]["type"]; // default "wikipedia"
  trustTier?: CanonChunk["trustTier"]; // default "primary"
  revisionId?: number;
};

const MAX_CHARS = 1200;

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4); // ~4 chars/token, the standard rough estimate
}

// Stable id over the chunk's identity *and* text, so identical chunks collapse on
// re-ingest while distinct content stays distinct. 16 hex chars of SHA-256 is
// ample collision resistance for a single work's chunk set.
function chunkId(parts: Array<string | number | undefined>): string {
  const key = parts
    .map((p) => (p == null ? "" : String(p)))
    .join("|")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function wikiUrl(pageTitle?: string): string | undefined {
  if (!pageTitle) return undefined;
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`;
}

// Greedy pack sentences up to maxChars; hard-split any single sentence longer
// than the budget.
function splitBySentence(text: string, maxChars: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length > maxChars) {
      flush();
      for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars).trim());
      continue;
    }
    if (buf.length + s.length + 1 > maxChars) flush();
    buf = buf ? `${buf} ${s}` : s;
  }
  flush();
  return out;
}

// Split text into <= maxChars pieces, preferring paragraph boundaries, falling
// back to sentence boundaries for oversized paragraphs.
export function splitText(text: string, maxChars: number = MAX_CHARS): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = "";
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      flush();
      for (const piece of splitBySentence(para, maxChars)) chunks.push(piece);
      continue;
    }
    if (buf.length + para.length + 2 > maxChars) flush();
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  flush();
  return chunks;
}

function dedupe(chunks: CanonChunk[]): CanonChunk[] {
  const byId = new Map<string, CanonChunk>();
  for (const c of chunks) if (!byId.has(c.id)) byId.set(c.id, c);
  return [...byId.values()];
}

/** Chunk per-episode summaries into episode-scoped CanonChunks. */
export function chunkEpisodes(episodes: Episode[], ctx: ChunkSource): CanonChunk[] {
  const sourceType = ctx.sourceType ?? "wikipedia";
  const trustTier = ctx.trustTier ?? "primary";
  const out: CanonChunk[] = [];

  for (const ep of episodes) {
    const text = ep.shortSummary?.trim();
    if (!text) continue; // no canon prose for this episode
    const title = ep.title ?? ep.titleEn;
    const episode = ep.episodeNumber ?? ep.episodeNumber2;
    for (const piece of splitText(text)) {
      out.push({
        id: chunkId([ctx.franchise, "episode", ep.season, episode, title, piece]),
        franchise: ctx.franchise,
        scope: "episode",
        season: ep.season,
        episode,
        title,
        text: piece,
        tokensApprox: approxTokens(piece),
        source: {
          type: sourceType,
          pageTitle: ep.sourcePage,
          url: wikiUrl(ep.sourcePage),
          revisionId: ctx.revisionId,
        },
        trustTier,
      });
    }
  }
  return dedupe(out);
}

/** Chunk plot/premise prose into page-scoped CanonChunks. */
export function chunkPlot(plot: PlotResult, ctx: ChunkSource): CanonChunk[] {
  if (!plot.found || !plot.text.trim()) return [];
  const sourceType = ctx.sourceType ?? "wikipedia";
  const trustTier = ctx.trustTier ?? "primary";

  const out: CanonChunk[] = splitText(plot.text).map((piece) => ({
    id: chunkId([ctx.franchise, "page", plot.section, piece]),
    franchise: ctx.franchise,
    scope: "page" as const,
    title: plot.section,
    text: piece,
    tokensApprox: approxTokens(piece),
    source: {
      type: sourceType,
      pageTitle: plot.pageTitle,
      url: wikiUrl(plot.pageTitle),
      revisionId: ctx.revisionId,
    },
    trustTier,
  }));
  return dedupe(out);
}
