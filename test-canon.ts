import { getEpisodesFromPage } from "./src/canon/wikitext.js";
import { getEpisodes } from "./src/canon/episodes.js";
import { getPlot } from "./src/canon/plot.js";
import { chunkEpisodes, chunkPlot, type CanonChunk } from "./src/canon/chunk.js";
import { cacheEnabled, ensureSchema, getCanon, closeCache } from "./src/canon/cache.js";
import { resolveTitle, type Candidate, type CandidateType } from "./src/canon/resolve.js";
import { generateStory } from "./src/generate/generate.js";

const DASH = "—";

function fmt(v: string | number | undefined): string {
  if (v === undefined || v === null || v === "") return DASH;
  return String(v);
}

function preview(s: string | undefined, n: number): string {
  if (!s) return DASH;
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function printCandidate(c: Candidate, indent = "  "): void {
  const qid = c.wikidataId ?? "no-qid";
  console.log(`${indent}- "${c.pageTitle}" [${c.type}] (${qid})`);
  if (c.snippet) console.log(`${indent}  snippet: ${c.snippet}`);
}

async function runResolve(query: string): Promise<void> {
  console.log(`resolve: "${query}"`);
  const result = await resolveTitle(query);
  console.log(`status: ${result.status}`);
  if (result.status === "high") {
    console.log("chosen:");
    printCandidate(result.chosen);
    if (result.alternates.length > 0) {
      console.log("alternates:");
      for (const c of result.alternates) printCandidate(c);
    }
  } else if (result.status === "medium") {
    console.log("candidates:");
    for (const c of result.candidates) printCandidate(c);
  } else {
    console.log(`reason: ${result.reason}`);
  }
}

async function runEpisodes(title: string): Promise<void> {
  const episodes = await getEpisodesFromPage(title);
  console.log(`page: ${title}`);
  console.log(`episodes found: ${episodes.length}`);
  console.log("");
  episodes.forEach((ep, i) => {
    const n = i + 1;
    console.log(
      `#${n} [overall=${fmt(ep.episodeNumber)}, in-season=${fmt(ep.episodeNumber2)}] ${fmt(ep.title)}`,
    );
    console.log(`  air date: ${fmt(ep.airDate)}`);
    console.log(`  directed by: ${fmt(ep.directedBy)}`);
    console.log(`  written by: ${fmt(ep.writtenBy)}`);
    console.log(`  summary: ${preview(ep.shortSummary, 200)}`);
    console.log("");
  });
}

// Resolve a (possibly messy) title to a real work, then discover every episode
// across its list hub and season pages — the full task-6 path end to end.
async function runEpisodesDiscover(query: string): Promise<void> {
  const resolved = await resolveTitle(query);
  let pageTitle: string | undefined;
  if (resolved.status === "high") pageTitle = resolved.chosen.pageTitle;
  else if (resolved.status === "medium") pageTitle = resolved.candidates[0]?.pageTitle;

  if (!pageTitle) {
    console.log(`could not resolve "${query}" (status: ${resolved.status})`);
    return;
  }
  console.log(`resolved "${query}" -> "${pageTitle}"`);

  const { pagesScanned, episodes } = await getEpisodes(pageTitle);
  console.log(`pages scanned (${pagesScanned.length}): ${pagesScanned.join(", ")}`);
  console.log(`episodes found: ${episodes.length}`);
  console.log("");
  episodes.forEach((ep, i) => {
    const n = i + 1;
    console.log(
      `#${n} [overall=${fmt(ep.episodeNumber)}, S${fmt(ep.season)}E${fmt(ep.episodeNumber2)}] ${fmt(ep.title)}`,
    );
    console.log(`  air date: ${fmt(ep.airDate)}  | source: ${ep.sourcePage}`);
    console.log(`  summary: ${preview(ep.shortSummary, 160)}`);
    console.log("");
  });
}

// Resolve a title, then extract its plot/premise prose (films, books, etc.).
async function runPlotDiscover(query: string): Promise<void> {
  const resolved = await resolveTitle(query);
  let pageTitle: string | undefined;
  if (resolved.status === "high") pageTitle = resolved.chosen.pageTitle;
  else if (resolved.status === "medium") pageTitle = resolved.candidates[0]?.pageTitle;

  if (!pageTitle) {
    console.log(`could not resolve "${query}" (status: ${resolved.status})`);
    return;
  }
  console.log(`resolved "${query}" -> "${pageTitle}"`);

  const plot = await getPlot(pageTitle);
  if (!plot.found) {
    console.log("no plot/premise section found");
    return;
  }
  const words = plot.text.split(/\s+/).filter(Boolean).length;
  console.log(`section: ${plot.section}  | ${words} words, ${plot.text.length} chars\n`);
  console.log(plot.text);
}

// ---- Task 8: formal end-to-end validation across the 4 title types ----

type ValidationCase = {
  label: string;
  query: string;
  preferType?: CandidateType;
  mode: "episodes" | "plot";
  expectTypes: CandidateType[];
  // Minimum count (episodes) or word count (plot) for a pass.
  min: number;
};

const VALIDATION_CASES: ValidationCase[] = [
  { label: "TV series", query: "Star Trek: Picard", preferType: "tv_series", mode: "episodes", expectTypes: ["tv_series"], min: 25 },
  { label: "Foundation (as TV)", query: "Foundation", preferType: "tv_series", mode: "episodes", expectTypes: ["tv_series"], min: 18 },
  { label: "Foundation (as book)", query: "Foundation", preferType: "book", mode: "plot", expectTypes: ["book", "book_series"], min: 100 },
  { label: "Film", query: "Inception", preferType: "film", mode: "plot", expectTypes: ["film"], min: 200 },
  { label: "Standalone book", query: "The Great Gatsby", preferType: "book", mode: "plot", expectTypes: ["book"], min: 200 },
];

async function runValidate(): Promise<void> {
  console.log("Task 8 — end-to-end validation\n");
  let passes = 0;

  for (const c of VALIDATION_CASES) {
    const resolved = await resolveTitle(c.query, c.preferType ? { preferType: c.preferType } : undefined);
    let pageTitle: string | undefined;
    let resolvedType: CandidateType | undefined;
    if (resolved.status === "high") {
      pageTitle = resolved.chosen.pageTitle;
      resolvedType = resolved.chosen.type;
    } else if (resolved.status === "medium") {
      pageTitle = resolved.candidates[0]?.pageTitle;
      resolvedType = resolved.candidates[0]?.type;
    }

    let metric = 0;
    let detail = "";
    if (pageTitle) {
      if (c.mode === "episodes") {
        const { episodes } = await getEpisodes(pageTitle);
        metric = episodes.length;
        detail = `${metric} episodes`;
      } else {
        const plot = await getPlot(pageTitle);
        metric = plot.found ? plot.text.split(/\s+/).filter(Boolean).length : 0;
        detail = plot.found ? `${metric} words (section: ${plot.section})` : "no plot section";
      }
    }

    const typeOk = resolvedType !== undefined && c.expectTypes.includes(resolvedType);
    const metricOk = metric >= c.min;
    const ok = Boolean(pageTitle) && typeOk && metricOk;
    if (ok) passes++;

    console.log(`${ok ? "PASS" : "FAIL"}  ${c.label}: "${c.query}"`);
    console.log(`      -> "${pageTitle ?? "(unresolved)"}" [${resolvedType ?? "-"}] (${resolved.status})`);
    console.log(`      ${detail}  | need >= ${c.min}, type in {${c.expectTypes.join(", ")}}`);
    console.log("");
  }

  console.log(`Result: ${passes}/${VALIDATION_CASES.length} passed`);
  if (passes < VALIDATION_CASES.length) process.exitCode = 1;
}

// Full pipeline: resolve -> extract (episodes for TV, plot otherwise) -> chunk.
async function runChunks(query: string): Promise<void> {
  const resolved = await resolveTitle(query);
  let pageTitle: string | undefined;
  let type: CandidateType | undefined;
  if (resolved.status === "high") {
    pageTitle = resolved.chosen.pageTitle;
    type = resolved.chosen.type;
  } else if (resolved.status === "medium") {
    pageTitle = resolved.candidates[0]?.pageTitle;
    type = resolved.candidates[0]?.type;
  }
  if (!pageTitle) {
    console.log(`could not resolve "${query}" (status: ${resolved.status})`);
    return;
  }
  console.log(`resolved "${query}" -> "${pageTitle}" [${type}]`);

  const ctx = { franchise: pageTitle };
  let chunks: CanonChunk[] = [];
  if (type === "tv_series") {
    const { episodes } = await getEpisodes(pageTitle);
    chunks = chunkEpisodes(episodes, ctx);
    console.log(`${episodes.length} episodes -> ${chunks.length} chunks`);
  } else {
    const plot = await getPlot(pageTitle);
    chunks = chunkPlot(plot, ctx);
    console.log(`plot (${plot.section}) -> ${chunks.length} chunks`);
  }

  const totalTokens = chunks.reduce((n, c) => n + c.tokensApprox, 0);
  const maxLen = chunks.reduce((m, c) => Math.max(m, c.text.length), 0);
  console.log(`total ~${totalTokens} tokens | longest chunk ${maxLen} chars (cap 1200)`);

  // Dedup proof: chunking the same canon twice must yield identical ids.
  const idsA = new Set(chunks.map((c) => c.id));
  const dupCheck = type === "tv_series"
    ? chunkEpisodes((await getEpisodes(pageTitle)).episodes, ctx)
    : chunkPlot(await getPlot(pageTitle), ctx);
  const stable = dupCheck.length === chunks.length && dupCheck.every((c) => idsA.has(c.id));
  console.log(`stable-hash dedup: ${stable ? "OK (ids identical on re-run)" : "MISMATCH"}`);

  console.log("\nfirst 2 chunks:");
  for (const c of chunks.slice(0, 2)) {
    console.log(`  [${c.id}] scope=${c.scope} S${c.season ?? "-"}E${c.episode ?? "-"} "${c.title ?? ""}" (~${c.tokensApprox} tok)`);
    console.log(`    ${preview(c.text, 140)}`);
  }
}

// Task 10: full cached pipeline. Runs twice to show cold (miss) then warm (hit).
async function runCache(query: string): Promise<void> {
  if (!cacheEnabled()) {
    console.log("DATABASE_URL is not set — set a Neon connection string to use the cache.");
    console.log("(The extractor still runs uncached; getCanon() just won't persist.)");
    return;
  }
  console.log("ensuring schema...");
  await ensureSchema();

  const t0 = Date.now();
  const cold = await getCanon(query);
  const t1 = Date.now();
  console.log(`cold: "${query}" -> "${cold.pageTitle}" [${cold.type}] | ${cold.chunks.length} chunks (${cold.scope}) | cached=${cold.cached} | ${t1 - t0}ms`);

  const warm = await getCanon(query);
  const t2 = Date.now();
  console.log(`warm: ${warm.chunks.length} chunks | cached=${warm.cached} | ${t2 - t1}ms`);

  console.log(warm.cached ? "OK — second call served from cache" : "WARN — second call was not cached");
  await closeCache();
}

async function runGenerate(work: string, prompt: string): Promise<void> {
  console.log(`work: "${work}"`);
  console.log(`prompt: "${prompt}"\n`);
  const t0 = Date.now();
  const result = await generateStory({ work, prompt });
  const t1 = Date.now();

  console.log(`--- STORY (${result.pageTitle}) ---\n`);
  console.log(result.story);
  console.log(`\n--- CITATIONS (${result.citations.length}) ---`);
  for (let i = 0; i < result.citations.length; i++) {
    const c = result.citations[i];
    const loc = c.scope === "episode"
      ? `S${c.season ?? "?"}E${c.episode ?? "?"} "${c.title ?? "-"}"`
      : c.title ?? c.scope;
    console.log(`  [${i + 1}] ${loc}  (dist=${c.distance.toFixed(3)})`);
  }
  console.log(`\nusage: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out | ${t1 - t0}ms`);
  await closeCache();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("usage:");
    console.log('  tsx test-canon.ts <wikipedia page title>          (parse one page)');
    console.log('  tsx test-canon.ts --resolve <query>               (title -> real work)');
    console.log('  tsx test-canon.ts --episodes <query>              (resolve + discover all episodes)');
    console.log('  tsx test-canon.ts --plot <query>                  (resolve + extract plot/premise)');
    console.log('  tsx test-canon.ts --chunks <query>                (task 9: resolve + extract + chunk)');
    console.log('  tsx test-canon.ts --cache <query>                 (task 10: cached pipeline, needs DATABASE_URL)');
    console.log('  tsx test-canon.ts --validate                      (task 8: run the 4-title test suite)');
    console.log('  tsx test-canon.ts --generate "<work>" :: "<prompt>"  (generate a story; needs OPENAI_API_KEY + ANTHROPIC_API_KEY)');
    return;
  }

  if (args[0] === "--generate") {
    const rest = args.slice(1).join(" ").trim();
    const parts = rest.split("::").map((s) => s.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      console.error('ERROR: --generate expects: --generate "<work>" :: "<prompt>"');
      process.exit(1);
    }
    await runGenerate(parts[0], parts[1]);
    return;
  }

  if (args[0] === "--validate") {
    await runValidate();
    return;
  }

  if (args[0] === "--chunks") {
    const query = args.slice(1).join(" ").trim();
    if (!query) {
      console.error("ERROR: --chunks requires a query");
      process.exit(1);
    }
    await runChunks(query);
    return;
  }

  if (args[0] === "--cache") {
    const query = args.slice(1).join(" ").trim();
    if (!query) {
      console.error("ERROR: --cache requires a query");
      process.exit(1);
    }
    await runCache(query);
    return;
  }

  if (args[0] === "--plot") {
    const query = args.slice(1).join(" ").trim();
    if (!query) {
      console.error("ERROR: --plot requires a query");
      process.exit(1);
    }
    await runPlotDiscover(query);
    return;
  }

  if (args[0] === "--resolve") {
    const query = args.slice(1).join(" ").trim();
    if (!query) {
      console.error("ERROR: --resolve requires a query");
      process.exit(1);
    }
    await runResolve(query);
    return;
  }

  if (args[0] === "--episodes") {
    const query = args.slice(1).join(" ").trim();
    if (!query) {
      console.error("ERROR: --episodes requires a query");
      process.exit(1);
    }
    await runEpisodesDiscover(query);
    return;
  }

  await runEpisodes(args[0]);
}

try {
  await main();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}
