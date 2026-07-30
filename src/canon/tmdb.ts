// TMDB overlay: fills in reliable season/episode numbers, episode titles, and
// air dates that Wikipedia's wikitext-template parsing sometimes gets wrong or
// omits entirely (e.g. shows with no season subpages, like The Society).
//
// Best-effort only, by design: no TMDB_API_KEY, no search match, a network
// error, or a mismatched episode count just means the wikitext-only pipeline
// runs exactly as it did before this file existed. Nothing here is allowed to
// break canon extraction.

const TMDB_BASE = "https://api.themoviedb.org/3";

export type TmdbEpisode = {
  season: number;
  episode: number;
  title: string;
  airDate?: string;
};

function apiKey(): string | undefined {
  return process.env.TMDB_API_KEY;
}

export function tmdbEnabled(): boolean {
  return Boolean(apiKey());
}

async function tmdbGet<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const key = apiKey();
  if (!key) return null;
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Find the TMDB show id best matching a title. Best-effort: null on any miss. */
export async function resolveTmdbShow(title: string): Promise<number | null> {
  const data = await tmdbGet<{ results: Array<{ id: number; name: string }> }>("/search/tv", { query: title });
  const top = data?.results?.[0];
  return top?.id ?? null;
}

/** All episodes for a show across every season, flattened. Best-effort. */
export async function getTmdbEpisodes(showId: number): Promise<TmdbEpisode[]> {
  const show = await tmdbGet<{ number_of_seasons?: number }>(`/tv/${showId}`);
  const seasonCount = show?.number_of_seasons ?? 0;
  if (seasonCount === 0) return [];

  const out: TmdbEpisode[] = [];
  for (let s = 1; s <= seasonCount; s++) {
    const season = await tmdbGet<{
      episodes?: Array<{ episode_number: number; name: string; air_date?: string }>;
    }>(`/tv/${showId}/season/${s}`);
    for (const ep of season?.episodes ?? []) {
      out.push({ season: s, episode: ep.episode_number, title: ep.name, airDate: ep.air_date || undefined });
    }
  }
  return out;
}
