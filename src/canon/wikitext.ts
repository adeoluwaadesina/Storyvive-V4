import { fetchWiki } from "./client.js";

export type EpisodeListEntry = {
  title?: string;
  titleEn?: string;
  episodeNumber?: number;
  episodeNumber2?: number;
  directedBy?: string;
  writtenBy?: string;
  airDate?: string;
  shortSummary?: string;
  raw: Record<string, string>;
};

type ParseResponse = {
  parse?: { wikitext: string };
  error?: { code?: string; info?: string };
};

export async function fetchWikitext(pageTitle: string): Promise<string> {
  const res = await fetchWiki<ParseResponse>({
    action: "parse",
    page: pageTitle,
    prop: "wikitext",
  });
  if (res.error || !res.parse?.wikitext) {
    const why = res.error?.info ?? "no wikitext in response";
    throw new Error(`fetchWikitext: missing page "${pageTitle}" (${why})`);
  }
  return res.parse.wikitext;
}

type RevisionResponse = {
  query?: {
    pages?: Array<{
      pageid?: number;
      title: string;
      missing?: boolean;
      revisions?: Array<{ revid: number }>;
    }>;
  };
};

/** Current pageId + latest revisionId for a page, used for cache freshness. */
export async function fetchPageRevision(
  pageTitle: string,
): Promise<{ pageId?: number; revisionId?: number }> {
  const res = await fetchWiki<RevisionResponse>({
    action: "query",
    titles: pageTitle,
    prop: "revisions",
    rvprop: "ids",
    rvlimit: "1",
    redirects: "1",
  });
  const page = res.query?.pages?.[0];
  if (!page || page.missing) return {};
  return { pageId: page.pageid, revisionId: page.revisions?.[0]?.revid };
}

// Split a template body on top-level `|` only — `|` inside nested {{…}} or
// [[…]] doesn't separate parameters.
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let braceDepth = 0;
  let bracketDepth = 0;
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const c2 = s[i + 1];
    if (c === "{" && c2 === "{") {
      braceDepth++;
      i += 2;
    } else if (c === "}" && c2 === "}") {
      braceDepth--;
      i += 2;
    } else if (c === "[" && c2 === "[") {
      bracketDepth++;
      i += 2;
    } else if (c === "]" && c2 === "]") {
      bracketDepth--;
      i += 2;
    } else if (c === "|" && braceDepth === 0 && bracketDepth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
      i++;
    } else {
      i++;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

// Walk char-by-char, tracking {{…}} / [[…]] depths, collecting every template
// body. Recurses into bodies so nested Episode list templates are still found.
function collectTemplates(text: string, out: { name: string; body: string }[]): void {
  let i = 0;
  while (i < text.length) {
    if (text[i] === "{" && text[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        const c = text[j];
        const c2 = text[j + 1];
        if (c === "{" && c2 === "{") {
          depth++;
          j += 2;
        } else if (c === "}" && c2 === "}") {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      const body = text.slice(i + 2, j - 2);
      const parts = splitTopLevel(body);
      const name = (parts[0] ?? "").trim();
      const lname = name.toLowerCase();
      if (
        process.env.SV_DEBUG === "1" &&
        (lname === "episode list" || lname === "episode list/sublist")
      ) {
        const fields: Record<string, string> = {};
        for (const p of parts.slice(1)) {
          const eq = p.indexOf("=");
          if (eq === -1) continue;
          fields[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
        }
        console.error(
          `[trace] ${name} | Title=${fields["title"] ?? "(no title)"} | EpisodeNumber=${fields["episodenumber"] ?? ""} | EpisodeNumber2=${fields["episodenumber2"] ?? ""}`,
        );
      }
      out.push({ name, body });
      // Recurse into the body so nested templates are also discovered.
      collectTemplates(parts.slice(1).join("|"), out);
      i = j;
    } else {
      i++;
    }
  }
}

function parseIntOrUndef(s: string | undefined): number | undefined {
  if (s == null) return undefined;
  const t = s.trim();
  if (!/^-?\d+$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

// Walk with a {{ depth counter and drop every template span — templates can
// nest, so regex isn't safe here.
function stripTemplates(input: string): string {
  let out = "";
  let depth = 0;
  let i = 0;
  while (i < input.length) {
    if (input[i] === "{" && input[i + 1] === "{") {
      depth++;
      i += 2;
    } else if (input[i] === "}" && input[i + 1] === "}") {
      if (depth > 0) depth--;
      i += 2;
    } else {
      if (depth === 0) out += input[i];
      i++;
    }
  }
  return out;
}

function stripWikiMarkup(input: string): string {
  let s = stripTemplates(input);
  // Drop <ref .../> and <ref ...>...</ref> (any tag content).
  s = s.replace(/<ref\b[^>]*\/>/gi, "");
  s = s.replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, "");
  // [[A|B]] → B, [[A]] → A
  s = s.replace(/\[\[([^\[\]|]+)\|([^\[\]]+)\]\]/g, "$2");
  s = s.replace(/\[\[([^\[\]]+)\]\]/g, "$1");
  // '''bold''' before ''italic'' so the latter doesn't eat the former.
  s = s.replace(/'''(.*?)'''/g, "$1");
  s = s.replace(/''(.*?)''/g, "$1");
  return s.replace(/\s+/g, " ").trim();
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// {{Start date|2020|1|23|df=y}} → "January 23, 2020" (drops df=/mf= flags).
function formatDateTemplate(positional: string[]): string {
  const ints = positional.filter((p) => /^\d+$/.test(p)).map(Number);
  const [y, m, d] = ints;
  if (!y) return "";
  if (m >= 1 && m <= 12 && d) return `${MONTHS[m - 1]} ${d}, ${y}`;
  if (m >= 1 && m <= 12) return `${MONTHS[m - 1]} ${y}`;
  return String(y);
}

// Render a single template body (without the outer {{ }}) to readable text:
// dates become dates, list templates become comma-joined items, a few wrappers
// pass through their content, and anything unrecognised is dropped (like
// stripTemplates would). Nested templates are expanded first.
function renderTemplate(body: string): string {
  const parts = splitTopLevel(expandTemplates(body));
  const name = (parts[0] ?? "").trim().toLowerCase();
  const args = parts.slice(1).map((a) => a.trim());
  const positional = args.filter((a) => !a.includes("="));

  switch (name) {
    case "start date":
    case "end date":
    case "start date and age":
    case "birth date":
      return formatDateTemplate(positional);
    case "ubl":
    case "unbulleted list":
    case "plainlist":
    case "flatlist":
    case "hlist":
    case "cslist":
    case "comma separated entries":
      return positional.filter(Boolean).join(", ");
    case "nowrap":
    case "nobr":
      return positional.join(" ");
    case "sortname":
      return positional.slice(0, 2).join(" ");
    default:
      return ""; // unknown template — drop, same as stripTemplates
  }
}

// Replace every {{template}} in a string with its rendered text (brace-depth
// aware so nested templates are handled correctly).
function expandTemplates(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    if (input[i] === "{" && input[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < input.length && depth > 0) {
        if (input[j] === "{" && input[j + 1] === "{") {
          depth++;
          j += 2;
        } else if (input[j] === "}" && input[j + 1] === "}") {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      out += renderTemplate(input.slice(i + 2, j - 2));
      i = j;
    } else {
      out += input[i];
      i++;
    }
  }
  return out;
}

// Clean a metadata field (airDate / directedBy / writtenBy): convert known
// templates to text, turn <br> into separators, then strip the remaining markup.
// So "{{Start date|2020|1|23}}<ref.../>" → "January 23, 2020" and
// "{{ubl|[[A]]|[[B]]}}" → "A, B".
function cleanMetaField(input: string): string {
  let s = input.replace(/<br\s*\/?>/gi, "; ");
  s = expandTemplates(s);
  s = stripWikiMarkup(s);
  s = s.replace(/\s*;\s*/g, "; ").replace(/(?:;\s*)+$/g, "").replace(/^(?:;\s*)+/g, "");
  return s.trim();
}

function cleanMaybe(v: string | undefined): string | undefined {
  if (v == null) return undefined;
  const cleaned = cleanMetaField(v);
  return cleaned.length > 0 ? cleaned : undefined;
}

function buildEntry(body: string): EpisodeListEntry {
  const parts = splitTopLevel(body).slice(1); // drop template name
  const raw: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const val = part.slice(eq + 1).trim();
    if (key) raw[key] = val;
  }
  const summary = raw["shortsummary"];
  const rawTitle = raw["title"];
  const rawTitleEn = raw["englishtitle"] ?? raw["rtitle"];
  return {
    title: rawTitle != null ? stripWikiMarkup(rawTitle) : undefined,
    titleEn: rawTitleEn != null ? stripWikiMarkup(rawTitleEn) : undefined,
    episodeNumber: parseIntOrUndef(raw["episodenumber"]),
    episodeNumber2: parseIntOrUndef(raw["episodenumber2"]),
    directedBy: cleanMaybe(raw["directedby"]),
    writtenBy: cleanMaybe(raw["writtenby"]),
    airDate: cleanMaybe(raw["originalairdate"]),
    shortSummary: summary != null ? stripWikiMarkup(summary) : undefined,
    raw,
  };
}

export function parseEpisodeListTemplates(wikitext: string): EpisodeListEntry[] {
  const all: { name: string; body: string }[] = [];
  collectTemplates(wikitext, all);
  const out: EpisodeListEntry[] = [];
  for (const tpl of all) {
    const n = tpl.name.toLowerCase();
    if (n === "episode list" || n === "episode list/sublist") {
      out.push(buildEntry(tpl.body));
    }
  }
  return out;
}

export async function getEpisodesFromPage(pageTitle: string): Promise<EpisodeListEntry[]> {
  const wt = await fetchWikitext(pageTitle);
  return parseEpisodeListTemplates(wt);
}
