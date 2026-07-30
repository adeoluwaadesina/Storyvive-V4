// Episode discovery + parsing across every page a series spreads its episode
// tables over: the main article, the "List of <X> episodes" hub, and per-season
// pages / transcluded sublists. We fetch each page, parse its {{Episode list}}
// rows with the existing wikitext parser, then merge and de-dupe into one
// ordered list.
//
// Why a crawl and not a single fetch: action=parse returns *raw* wikitext, so
// transclusions ({{:List of X episodes (season 2)}}) are not expanded. The rows
// live on the transcluded page, so we follow those references ourselves. See
// V4 handover Section 5 and plan task 6.

import { fetchWikitext, parseEpisodeListTemplates, type EpisodeListEntry } from "./wikitext.js";
import { resolveTmdbShow, getTmdbEpisodes, tmdbEnabled, type TmdbEpisode } from "./tmdb.js";

export type Episode = EpisodeListEntry & {
  /** Season number when it can be inferred from the source page title. */
  season?: number;
  /** The Wikipedia page this row was parsed from. */
  sourcePage: string;
  /** True when the raw title was a [[wikilink]] — real episodes link to their
   *  own article; parallel "making-of" tables that reuse {{Episode list}} do not. */
  titleLinked?: boolean;
};

export type EpisodesResult = {
  /** Every page we actually fetched and parsed, in visit order. */
  pagesScanned: string[];
  /** Merged, de-duped, ordered episodes. */
  episodes: Episode[];
};

// Politeness + safety ceilings. The client serialises requests already; these
// bound how far a single discovery can crawl.
const PAGE_CAP = 60; // hard ceiling on pages fetched per discovery
const MAX_DEPTH = 2; // main page -> list hub -> season sublists

const NON_ARTICLE_NS =
  /^(File|Image|Category|Wikipedia|Help|Template|Portal|Module|Draft|User|Talk|MediaWiki|Special):/i;

/** Does a page title look like it holds episodes (a list hub or a season page)? */
function isEpisodePageTitle(t: string): boolean {
  if (NON_ARTICLE_NS.test(t)) return false;
  return (
    /^List of .+ episodes$/i.test(t) ||
    /\(season \d+\)$/i.test(t) ||
    /\bseason \d+$/i.test(t)
  );
}

/** Pull a season number out of a page title like "X (season 3)" or "X season 3". */
function seasonFromTitle(t: string): number | undefined {
  const m = /\(season (\d+)\)$/i.exec(t) ?? /\bseason (\d+)$/i.exec(t);
  return m ? Number(m[1]) : undefined;
}

function decodeTitle(s: string): string {
  return s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

// Guard against crawling into a *different* series. Season/list pages of the
// same work contain the work's name ("List of X episodes", "X (season 2)"),
// while a cross-linked sibling series ("Star Trek: Discovery season 3" linked
// from a Picard page) does not contain "Star Trek: Picard".
function belongsToWork(title: string, baseNameLc: string): boolean {
  if (!baseNameLc) return true; // no usable base name — fall back to title-shape gate only
  return title.toLowerCase().includes(baseNameLc);
}

// Page titles referenced from one page's wikitext that are worth following:
// [[links]] to list/season pages, {{Main|List of ... episodes}} hatnotes, and
// (when this page is itself an episode hub) every {{:mainspace transclusion}},
// since those are the per-season sublists holding the actual rows.
function referencedEpisodePages(wt: string, followAllTransclusions: boolean): string[] {
  const found = new Set<string>();

  const linkRe = /\[\[\s*([^[\]|#]+?)\s*(?:\|[^[\]]*)?\]\]/g;
  for (let m: RegExpExecArray | null; (m = linkRe.exec(wt)); ) {
    const t = decodeTitle(m[1]);
    if (isEpisodePageTitle(t)) found.add(t);
  }

  const mainRe =
    /\{\{\s*(?:Main|Main article|Main list)\s*\|\s*([^|}\n]+?)\s*(?:\||\}\})/gi;
  for (let m: RegExpExecArray | null; (m = mainRe.exec(wt)); ) {
    const t = decodeTitle(m[1]);
    if (isEpisodePageTitle(t)) found.add(t);
  }

  // {{:Title}} transcludes a mainspace article — the per-season sublist pattern.
  const translRe = /\{\{\s*:\s*([^|}\n]+?)\s*(?:\||\}\})/g;
  for (let m: RegExpExecArray | null; (m = translRe.exec(wt)); ) {
    const t = decodeTitle(m[1]);
    if (NON_ARTICLE_NS.test(t)) continue;
    if (followAllTransclusions || isEpisodePageTitle(t)) found.add(t);
  }

  return [...found];
}

// A stable identity for an episode so the same episode parsed from two pages
// (e.g. the list hub and the season page) collapses to one. Title (+ air date)
// is the most reliable cross-page key: overall vs in-season numbering differs
// between a list hub and a season page, but the title does not.
function dedupeKey(e: Episode): string {
  // Title alone is the reliable cross-page identity: the same episode often
  // carries an air date on its season page but not on the list hub, so keying
  // on title+date would fail to collapse the two copies. Episode titles are
  // unique within a work (two-parters use distinct "Part 1"/"Part 2" titles).
  const title = (e.titleEn || e.title || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (title) return `t:${title}`;
  if (e.episodeNumber != null) return `n:${e.season ?? "?"}:${e.episodeNumber}`;
  if (e.season != null && e.episodeNumber2 != null) return `s:${e.season}:${e.episodeNumber2}`;
  return `r:${JSON.stringify(e.raw)}`;
}

// When the same episode appears twice, keep the fuller record (a row with a
// plot summary beats a bare one).
function richness(e: Episode): number {
  let r = 0;
  if (e.shortSummary) r += 3;
  if (e.airDate) r += 1;
  if (e.directedBy) r += 0.5;
  if (e.writtenBy) r += 0.5;
  return r + Object.keys(e.raw).length * 0.01;
}

function sortEpisodes(a: Episode, b: Episode): number {
  if (a.episodeNumber != null && b.episodeNumber != null) {
    return a.episodeNumber - b.episodeNumber;
  }
  const sa = a.season ?? Number.POSITIVE_INFINITY;
  const sb = b.season ?? Number.POSITIVE_INFINITY;
  if (sa !== sb) return sa - sb;
  const ea = a.episodeNumber2 ?? a.episodeNumber ?? Number.POSITIVE_INFINITY;
  const eb = b.episodeNumber2 ?? b.episodeNumber ?? Number.POSITIVE_INFINITY;
  return ea - eb;
}

// A real episode links to its own article; a parallel making-of table that
// reuses {{Episode list}} does not. When two rows fight over one episode slot,
// the linked one wins, then the fuller record.
function betterCanonical(a: Episode, b: Episode): boolean {
  if (!!a.titleLinked !== !!b.titleLinked) return !!a.titleLinked;
  return richness(a) > richness(b);
}

function merge(eps: Episode[]): Episode[] {
  // Pass 1: collapse the same episode appearing on multiple pages (list hub +
  // season page), keyed on title.
  const byTitle = new Map<string, Episode>();
  for (const e of eps) {
    const key = dedupeKey(e);
    const existing = byTitle.get(key);
    if (!existing || richness(e) > richness(existing)) byTitle.set(key, e);
  }

  // Pass 2: a series never has two episodes with the same overall number, so a
  // collision there means a parallel non-episode table (e.g. a "making-of"
  // documentary list) slipped in. Keep one per overall number; rows without an
  // overall number (two-part finales, etc.) are left untouched.
  const byNumber = new Map<number, Episode>();
  const noNumber: Episode[] = [];
  for (const e of byTitle.values()) {
    if (e.episodeNumber == null) {
      noNumber.push(e);
      continue;
    }
    const existing = byNumber.get(e.episodeNumber);
    if (!existing || betterCanonical(e, existing)) byNumber.set(e.episodeNumber, e);
  }

  return [...byNumber.values(), ...noNumber].sort(sortEpisodes);
}

/**
 * Discover and parse all episodes for a resolved work, starting from its
 * Wikipedia page title. Crawls the list hub and season pages (bounded by
 * PAGE_CAP / MAX_DEPTH), then merges and de-dupes.
 */
export async function getEpisodes(seedTitle: string): Promise<EpisodesResult> {
  const visited = new Set<string>();
  const pagesScanned: string[] = [];
  const collected: Episode[] = [];

  const frontier: Array<{ title: string; depth: number }> = [{ title: seedTitle, depth: 0 }];
  // Also try the conventional list page derived from the seed (drop any
  // trailing "(TV series)" style qualifier). If it doesn't exist the fetch
  // just fails and we skip it.
  const baseName = seedTitle.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+season \d+$/i, "").trim();
  const baseNameLc = baseName.toLowerCase();
  if (baseName) frontier.push({ title: `List of ${baseName} episodes`, depth: 0 });

  while (frontier.length > 0 && pagesScanned.length < PAGE_CAP) {
    const next = frontier.shift();
    if (!next) break;
    const { title, depth } = next;
    const key = title.toLowerCase();
    if (visited.has(key)) continue;
    visited.add(key);

    let wt: string;
    try {
      wt = await fetchWikitext(title);
    } catch {
      continue; // missing page (e.g. a guessed list title) — skip quietly
    }
    pagesScanned.push(title);

    const season = seasonFromTitle(title);
    for (const entry of parseEpisodeListTemplates(wt)) {
      // Skip rows that aren't real episodes: empty {{Episode list}} stubs, and
      // related-media rows that some list pages slip in (e.g. "El Camino: A
      // Breaking Bad Movie", a film whose title lives in `rtitle` -> titleEn with
      // no episode number). A real episode has a proper `title` or an episode
      // number; an englishtitle/rtitle alone is not enough.
      const hasIdentity =
        !!entry.title || entry.episodeNumber != null || entry.episodeNumber2 != null;
      if (!hasIdentity) continue;
      const titleLinked = /\[\[/.test(entry.raw["title"] ?? "");
      collected.push({ ...entry, season, sourcePage: title, titleLinked });
    }

    if (depth < MAX_DEPTH) {
      const followAll = isEpisodePageTitle(title);
      for (const ref of referencedEpisodePages(wt, followAll)) {
        if (!belongsToWork(ref, baseNameLc)) continue; // stay within this work
        if (!visited.has(ref.toLowerCase())) {
          frontier.push({ title: ref, depth: depth + 1 });
        }
      }
    }
  }

  const episodes = merge(collected);

  if (tmdbEnabled()) {
    try {
      const showId = await resolveTmdbShow(baseName || seedTitle);
      if (showId != null) {
        const tmdbEpisodes = await getTmdbEpisodes(showId);
        if (tmdbEpisodes.length > 0) applyTmdbOverlay(episodes, tmdbEpisodes);
      }
    } catch (err) {
      console.warn(`getEpisodes: TMDB overlay failed for "${seedTitle}"`, err);
    }
  }

  return { pagesScanned, episodes };
}

// Overlay TMDB's season/episode numbers, titles, and air dates onto the
// wikitext-derived episodes, in place. TMDB numbering is more reliable than
// the page-title/{{Episode list}} heuristic, so where a confident match
// exists it wins; anything unmatched is left exactly as the wikitext parser
// produced it.
function applyTmdbOverlay(episodes: Episode[], tmdbEpisodes: TmdbEpisode[]): void {
  const bySeasonAndNumber = new Map<string, TmdbEpisode>();
  for (const t of tmdbEpisodes) {
    bySeasonAndNumber.set(`${t.season}:${t.episode}`, t);
  }

  const withSeason = episodes.filter((e) => e.season != null);
  const withoutSeason = episodes.filter((e) => e.season == null);

  // Confident case: wikitext already knows the season, so match on season+number.
  for (const e of withSeason) {
    const num = e.episodeNumber ?? e.episodeNumber2;
    if (num == null) continue;
    const match = bySeasonAndNumber.get(`${e.season}:${num}`);
    if (match) overlayEpisode(e, match);
  }

  // Shows with no season subpages at all on Wikipedia (e.g. The Society,
  // single season; The OA, two seasons but never labeled) leave every
  // episode's `season` unset — but `sortEpisodes()` already put them in true
  // chronological order upstream. When *no* episode has a season AND the
  // total count matches TMDB's total across all its seasons, matching by
  // order is safe; anything less clean-cut is left alone rather than guessed.
  if (withSeason.length === 0 && withoutSeason.length === tmdbEpisodes.length) {
    const tmdbChronological = tmdbEpisodes
      .slice()
      .sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
    withoutSeason.forEach((e, i) => overlayEpisode(e, tmdbChronological[i]));
  }
}

function overlayEpisode(e: Episode, t: TmdbEpisode): void {
  e.season = t.season;
  e.episodeNumber = t.episode;
  if (t.title) e.title = t.title;
  if (t.airDate) e.airDate = t.airDate;
}
