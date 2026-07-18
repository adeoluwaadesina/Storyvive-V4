import { fetchWiki } from "./client.js";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const USER_AGENT =
  "Storyvive/4.0 (https://github.com/adeoluwaadesina/Storyvive-V4; contact via GitHub issues)";
// maxlag=20 is a compromise: still polite (bots often use 5), but tolerant of
// Wikidata's query-service lag spikes (sometimes hundreds of seconds) that would
// otherwise fail every read here. We are a low-volume read client, not a writer.
const WIKIDATA_DEFAULTS: Record<string, string> = {
  format: "json",
  formatversion: "2",
  origin: "*",
  maxlag: "20",
};

// Minimal Wikidata fetcher — downstream of fetchWiki calls so no queue needed.
// Mirrors client.ts's retry discipline: 429/5xx honor Retry-After, and a JSON-level
// {error:{code:"maxlag"}} response (Wikidata sends HTTP 200 with a stripped body
// under lag) is retried after a fixed wait rather than silently accepted.
// More retries + longer maxlag waits than client.ts: Wikidata's query-service lag
// can persist for tens of seconds, and this is a one-shot resolve, not a stream.
const WD_MAX_RETRIES = 5;
const WD_BACKOFF_MS = [1000, 2000, 4000, 8000, 15_000];
const WD_MAXLAG_WAIT_MS = [5000, 10_000, 15_000, 20_000, 30_000];
const WD_RETRY_AFTER_CAP_MS = 30_000;
const wdSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWikidata<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...WIKIDATA_DEFAULTS, ...params }).toString();
  const url = `${WIKIDATA_API}?${qs}`;
  let lastStatus = 0;
  for (let attempt = 0; attempt <= WD_MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    lastStatus = res.status;
    if (res.status === 429 || res.status >= 500) {
      if (attempt === WD_MAX_RETRIES) break;
      const ra = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(ra) && ra >= 0
        ? Math.min(ra * 1000, WD_RETRY_AFTER_CAP_MS)
        : WD_BACKOFF_MS[attempt] ?? WD_BACKOFF_MS[WD_BACKOFF_MS.length - 1];
      await wdSleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`fetchWikidata: HTTP ${res.status} for ${url}`);
    const body = (await res.json()) as T & { error?: { code?: string } };
    if (body?.error?.code === "maxlag") {
      if (attempt === WD_MAX_RETRIES) throw new Error(`fetchWikidata: maxlag exhausted for ${url}`);
      await wdSleep(WD_MAXLAG_WAIT_MS[attempt] ?? WD_MAXLAG_WAIT_MS[WD_MAXLAG_WAIT_MS.length - 1]);
      continue;
    }
    return body;
  }
  throw new Error(`fetchWikidata: retries exhausted (last status ${lastStatus}) for ${url}`);
}

export type CandidateType =
  | "tv_series"
  | "film"
  | "book"
  | "book_series"
  | "video_game"
  | "character"
  | "person"
  | "disambiguation"
  | "other";

export type Candidate = {
  pageTitle: string;
  wikidataId?: string;
  type: CandidateType;
  snippet: string;
};

export type ResolveResult =
  | { status: "high"; chosen: Candidate; alternates: Candidate[] }
  | { status: "medium"; candidates: Candidate[] }
  | { status: "low"; reason: string };

const TYPE_MAP: Record<string, CandidateType> = {
  Q5398426: "tv_series",
  Q581714: "tv_series",
  Q15416: "tv_series",
  Q11424: "film",
  Q24856: "film",
  Q571: "book",
  Q7725634: "book", // "literary work" — a single work (e.g. The Great Gatsby), not a series
  Q8261: "book",
  Q7889: "video_game",
  Q15773347: "character",
  Q95074: "character",
  Q5: "person",
  Q4167410: "disambiguation",
  Q1667921: "book_series",
  Q277759: "book_series",
  Q47461344: "book",
  Q1259759: "tv_series",
  Q63952888: "tv_series",
  Q21191270: "tv_series",
  Q117467246: "tv_series",
};

const MAX_CANDIDATES = 10;

type SearchResponse = {
  query?: { search?: Array<{ title: string; snippet: string }> };
};
type PagePropsResponse = {
  query?: {
    pages?: Array<{ title: string; pageprops?: { wikibase_item?: string } }>;
  };
};
type DisambigResponse = {
  query?: {
    pages?: Array<{
      title: string;
      missing?: boolean;
      pageprops?: { disambiguation?: string };
      links?: Array<{ ns: number; title: string }>;
    }>;
  };
};
type WbClaim = { mainsnak?: { datavalue?: { value?: { id?: string } } } };
type WbEntitiesResponse = {
  entities?: Record<string, { claims?: { P31?: WbClaim[] } }>;
};

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function pickType(claims: WbClaim[] | undefined): CandidateType {
  if (!claims) return "other";
  for (const c of claims) {
    const id = c.mainsnak?.datavalue?.value?.id;
    if (id && TYPE_MAP[id]) return TYPE_MAP[id];
  }
  return "other";
}

function isJunk(t: CandidateType): boolean {
  return t === "disambiguation" || t === "other";
}

// "book" and "book_series" are one family: a book query should accept either,
// since Wikidata is inconsistent about tagging a single novel vs its series.
const BOOK_FAMILY = new Set<CandidateType>(["book", "book_series"]);
function typeMatches(candidateType: CandidateType, preferType: CandidateType): boolean {
  if (candidateType === preferType) return true;
  return BOOK_FAMILY.has(candidateType) && BOOK_FAMILY.has(preferType);
}

// If the query maps to a disambiguation page, return its mainspace (ns=0)
// links — that's Wikipedia's authoritative "did you mean..." list.
async function getDisambigLinks(query: string): Promise<string[]> {
  const res = await fetchWiki<DisambigResponse>({
    action: "query",
    titles: query,
    prop: "pageprops|links",
    pllimit: "50",
    redirects: "1",
  });
  const page = res.query?.pages?.[0];
  if (!page || page.missing) return [];
  if (!page.pageprops || !("disambiguation" in page.pageprops)) return [];
  return (page.links ?? [])
    .filter((l) => l.ns === 0)
    .map((l) => l.title)
    .slice(0, 30);
}

// Narrative-first ordering used to sort disambig links after type lookup.
function disambigRank(t: CandidateType): number {
  switch (t) {
    case "tv_series": return 0;
    case "film": return 1;
    case "book_series": return 2;
    case "book": return 3;
    case "video_game": return 4;
    case "character": return 5;
    case "person": return 6;
    default: return 7; // disambiguation, other
  }
}

function typeRank(t: CandidateType, prefer?: CandidateType): number {
  if (prefer && t === prefer) return 0;
  switch (t) {
    case "tv_series": return 1;
    case "film": return 2;
    case "book_series": return 3;
    case "book": return 4;
    default: return 5;
  }
}

function biasOrder(cands: Candidate[], prefer?: CandidateType): Candidate[] {
  return cands
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const r = typeRank(a.c.type, prefer) - typeRank(b.c.type, prefer);
      return r !== 0 ? r : a.i - b.i; // stable: tie-break on original index
    })
    .map((x) => x.c);
}

export async function resolveTitle(
  query: string,
  opts?: { preferType?: CandidateType },
): Promise<ResolveResult> {
  const [disambigTitles, search] = [
    await getDisambigLinks(query),
    await fetchWiki<SearchResponse>({
      action: "query",
      list: "search",
      srsearch: `intitle:${query}`,
      srlimit: "10",
    }),
  ];
  const hits = search.query?.search ?? [];
  if (disambigTitles.length === 0 && hits.length === 0) {
    return { status: "low", reason: "no search results" };
  }

  const snippetByTitle = new Map<string, string>();
  for (const h of hits) snippetByTitle.set(h.title, stripTags(h.snippet));

  const searchTitlesOrdered = hits.map((h) => h.title);

  // Combined pool: every distinct title from both sources, sent in one
  // pageprops + Wikidata batch so we can type-check disambig links before
  // deciding which ones get the reserved slots.
  const POOL_CAP = 40;
  const poolTitles: string[] = [];
  const poolSeen = new Set<string>();
  for (const t of [...searchTitlesOrdered, ...disambigTitles]) {
    if (poolTitles.length >= POOL_CAP) break;
    if (!poolSeen.has(t)) {
      poolTitles.push(t);
      poolSeen.add(t);
    }
  }

  const pp = await fetchWiki<PagePropsResponse>({
    action: "query",
    prop: "pageprops",
    titles: poolTitles.join("|"),
  });
  const titleToQid = new Map<string, string>();
  for (const page of pp.query?.pages ?? []) {
    const qid = page.pageprops?.wikibase_item;
    if (qid) titleToQid.set(page.title, qid);
  }

  const qids = [...new Set([...titleToQid.values()])];
  const qidToType = new Map<string, CandidateType>();
  const qidToRawP31 = new Map<string, string[]>();
  if (qids.length > 0) {
    const ents = await fetchWikidata<WbEntitiesResponse>({
      action: "wbgetentities",
      ids: qids.join("|"),
      props: "claims",
      languages: "en",
    });
    for (const [qid, ent] of Object.entries(ents.entities ?? {})) {
      qidToType.set(qid, pickType(ent.claims?.P31));
      const raw = (ent.claims?.P31 ?? [])
        .map((c) => c.mainsnak?.datavalue?.value?.id)
        .filter((x): x is string => Boolean(x));
      qidToRawP31.set(qid, raw);
    }
  }

  const typeFor = (t: string): CandidateType => {
    const qid = titleToQid.get(t);
    return qid ? (qidToType.get(qid) ?? "other") : "other";
  };

  // Sort disambig titles by narrative priority; stable on document order.
  const disambigSorted = disambigTitles
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const r = disambigRank(typeFor(a.t)) - disambigRank(typeFor(b.t));
      return r !== 0 ? r : a.i - b.i;
    })
    .map((x) => x.t);

  const SEARCH_SLOTS = 6;
  const DISAMBIG_SLOTS = 4;

  const titles: string[] = [];
  const seen = new Set<string>();

  let searchAdded = 0;
  for (const t of searchTitlesOrdered) {
    if (searchAdded >= SEARCH_SLOTS) break;
    if (!seen.has(t)) {
      titles.push(t);
      seen.add(t);
      searchAdded++;
    }
  }

  let disambigAdded = 0;
  for (const t of disambigSorted) {
    if (disambigAdded >= DISAMBIG_SLOTS) break;
    if (!seen.has(t)) {
      titles.push(t);
      seen.add(t);
      disambigAdded++;
    }
  }

  for (const t of searchTitlesOrdered) {
    if (titles.length >= MAX_CANDIDATES) break;
    if (!seen.has(t)) {
      titles.push(t);
      seen.add(t);
    }
  }
  for (const t of disambigSorted) {
    if (titles.length >= MAX_CANDIDATES) break;
    if (!seen.has(t)) {
      titles.push(t);
      seen.add(t);
    }
  }

  if (process.env.SV_DEBUG === "1") {
    console.error(`[resolve trace] query="${query}"`);
    console.error(`  sources:`);
    console.error(
      `    search: ${searchTitlesOrdered.length} hits → [${searchTitlesOrdered.join(", ")}]`,
    );
    console.error(
      `    disambig: ${disambigTitles.length} links → [${disambigTitles.join(", ")}]`,
    );
    console.error(`  titles considered (${titles.length}):`);
    for (const t of titles) {
      const qid = titleToQid.get(t);
      const raw = qid ? qidToRawP31.get(qid) ?? [] : [];
      const p31 = raw.length > 0 ? raw.join(",") : "no claims";
      const mapped = qid ? (qidToType.get(qid) ?? "other") : "other";
      console.error(`    - ${t}  qid=${qid ?? "-"}  P31=${p31}  → mapped type=${mapped}`);
    }
  }

  const candidates: Candidate[] = titles.map((t) => {
    const qid = titleToQid.get(t);
    return {
      pageTitle: t,
      wikidataId: qid,
      type: qid ? (qidToType.get(qid) ?? "other") : "other",
      snippet: snippetByTitle.get(t) ?? "",
    };
  });

  if (opts?.preferType) {
    const matched = candidates.filter((c) => typeMatches(c.type, opts.preferType!));
    if (matched.length === 1) {
      const chosen = matched[0];
      const alternates = candidates.filter((c) => c !== chosen);
      return { status: "high", chosen, alternates };
    }
    if (matched.length > 1) {
      return { status: "medium", candidates: biasOrder(matched, opts.preferType) };
    }
    // 0 matches → fall through to default logic.
  }

  const usable = candidates.filter((c) => !isJunk(c.type));
  if (usable.length === 1) {
    const only = usable[0];
    // Don't auto-pick a bare person/character — Storyvive wants the narrative work.
    if (!opts?.preferType && (only.type === "person" || only.type === "character")) {
      return { status: "medium", candidates: biasOrder(candidates, opts?.preferType) };
    }
    const alternates = candidates.filter((c) => c !== only);
    return { status: "high", chosen: only, alternates };
  }
  if (usable.length > 1) {
    return { status: "medium", candidates: biasOrder(usable, opts?.preferType) };
  }
  return { status: "low", reason: "no usable candidates" };
}
