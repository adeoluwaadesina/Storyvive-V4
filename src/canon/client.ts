const API_URL = "https://en.wikipedia.org/w/api.php";
const USER_AGENT =
  "Storyvive/4.0 (https://github.com/adeoluwaadesina/Storyvive-V4; contact via GitHub issues)";

const DEFAULT_PARAMS: Record<string, string> = {
  format: "json",
  formatversion: "2",
  origin: "*",
  maxlag: "5",
};

const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 2000, 4000];
const JITTER_MS = 200;
const RETRY_AFTER_CAP_MS = 30_000;
const MAXLAG_WAIT_MS = 5000;

// Serial queue: each call chains onto the previous tail so concurrent callers
// run one-at-a-time and we never hammer the API from parallel call sites.
let queueTail: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildUrl(params: Record<string, string>): string {
  const merged = { ...DEFAULT_PARAMS, ...params };
  const qs = new URLSearchParams(merged).toString();
  return `${API_URL}?${qs}`;
}

function backoffDelay(attempt: number): number {
  const base = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  const jitter = Math.floor((Math.random() * 2 - 1) * JITTER_MS);
  return Math.max(0, base + jitter);
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
}

async function doFetch<T>(url: string): Promise<T> {
  let lastStatus = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    lastStatus = res.status;

    // Retry on 429 / 5xx, honoring Retry-After when present.
    if (res.status === 429 || res.status >= 500) {
      if (attempt === MAX_RETRIES) break;
      const wait = retryAfterMs(res.headers.get("retry-after")) ?? backoffDelay(attempt);
      await sleep(wait);
      continue;
    }

    if (!res.ok) {
      throw new Error(`fetchWiki: HTTP ${res.status} for ${url}`);
    }

    const body = (await res.json()) as T & { error?: { code?: string } };

    // MediaWiki "maxlag" is a soft rate-limit signaled in the JSON body, not HTTP.
    if (body?.error?.code === "maxlag") {
      if (attempt === MAX_RETRIES) {
        throw new Error(`fetchWiki: maxlag exhausted for ${url}`);
      }
      await sleep(MAXLAG_WAIT_MS);
      continue;
    }

    return body;
  }

  throw new Error(`fetchWiki: retries exhausted (last status ${lastStatus}) for ${url}`);
}

export async function fetchWiki<T>(params: Record<string, string>): Promise<T> {
  const url = buildUrl(params);
  const run = queueTail.then(() => doFetch<T>(url));
  // Keep the queue alive even if this call rejects.
  queueTail = run.catch(() => undefined);
  return run;
}
