// Plot / premise prose extraction for films and books (and anything else whose
// canon lives in narrative prose rather than an episode table). We fetch the
// article wikitext, locate the best plot-bearing section, pull its body
// (including subsections), and clean the wiki markup down to readable prose the
// story generator can read. See plan task 7.

import { fetchWikitext } from "./wikitext.js";

export type PlotResult = {
  pageTitle: string;
  /** The heading we extracted from, e.g. "Plot" or "Premise". Empty if none found. */
  section: string;
  /** Cleaned prose. Empty when no plot-bearing section exists. */
  text: string;
  found: boolean;
};

type Section = { heading: string; level: number; body: string };

// Section headings that carry the story, best first. We pick the highest-priority
// one present on the page.
const SECTION_PRIORITY = [
  "plot",
  "plot summary",
  "synopsis",
  "plot synopsis",
  "premise",
  "story",
  "storyline",
  "overview",
];

// Split wikitext into sections on == Heading == lines (levels 2-6). The text
// before the first heading is the lead, kept as a level-1 "(lead)" section.
function getSections(wt: string): Section[] {
  const headingRe = /^(={2,6})\s*(.+?)\s*\1\s*$/;
  const sections: Section[] = [];
  let heading = "(lead)";
  let level = 1;
  let lines: string[] = [];
  const flush = () => sections.push({ heading, level, body: lines.join("\n") });

  for (const line of wt.split(/\r?\n/)) {
    const m = headingRe.exec(line.trim());
    if (m) {
      flush();
      level = m[1].length;
      heading = m[2].trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

// Body of the chosen section plus every following subsection (deeper level),
// stopping at the next heading of the same or higher level. So "Plot" picks up
// its "=== Act one ===" subsections but not the next top-level section.
function sectionWithSubsections(sections: Section[], index: number): string {
  const base = sections[index];
  const parts = [base.body];
  for (let i = index + 1; i < sections.length; i++) {
    if (sections[i].level <= base.level) break;
    const sub = sections[i];
    if (sub.heading) parts.push(`${sub.heading}.`); // keep subsection name as a lead-in
    parts.push(sub.body);
  }
  return parts.join("\n\n");
}

// Walk with a {{ depth counter and drop every template span — templates nest,
// so a regex isn't safe.
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

// Drop [[File:...]] / [[Image:...]] links whole, including nested [[ ]] in their
// captions, by tracking bracket depth from the opening of a media link.
function stripMediaLinks(input: string): string {
  return input.replace(
    /\[\[\s*(?:File|Image)\s*:[\s\S]*?\]\](?=[^\]]|$)/gi,
    "",
  );
}

function cleanProse(input: string): string {
  let s = input;
  s = s.replace(/<!--[\s\S]*?-->/g, ""); // HTML comments
  s = stripTemplates(s); // {{convert|...}}, {{'}}, infobox leftovers, etc.
  s = s.replace(/<ref\b[^>]*\/>/gi, ""); // self-closing refs
  s = s.replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, ""); // full refs
  s = stripMediaLinks(s);
  s = s.replace(/\[\[([^[\]|]+)\|([^[\]]+)\]\]/g, "$2"); // [[A|B]] -> B
  s = s.replace(/\[\[([^[\]]+)\]\]/g, "$1"); // [[A]] -> A
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1"); // [url label] -> label
  s = s.replace(/\[https?:\/\/\S+\]/g, ""); // bare [url]
  s = s.replace(/<[^>]+>/g, ""); // any remaining HTML tags
  s = s.replace(/'''(.*?)'''/g, "$1"); // bold
  s = s.replace(/''(.*?)''/g, "$1"); // italic

  // Line-level cleanup: drop list/indent/table markers, blank-collapse.
  const cleanedLines = s
    .split(/\r?\n/)
    .map((l) => l.replace(/^[*#:;]+\s?/, "").replace(/^\s*\|.*$/, "").trim());
  s = cleanedLines.join("\n");
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * Extract plot/premise prose from a Wikipedia article. Returns the cleaned text
 * and which section it came from; `found` is false when the page has no
 * plot-bearing section (e.g. a stub, or a non-narrative subject).
 */
export async function getPlot(pageTitle: string): Promise<PlotResult> {
  const wt = await fetchWikitext(pageTitle);
  const sections = getSections(wt);

  const byHeading = new Map<string, number>();
  sections.forEach((s, i) => {
    const key = s.heading.toLowerCase();
    if (!byHeading.has(key)) byHeading.set(key, i);
  });

  let chosenIndex = -1;
  let chosenName = "";
  for (const name of SECTION_PRIORITY) {
    const idx = byHeading.get(name);
    if (idx !== undefined) {
      chosenIndex = idx;
      chosenName = sections[idx].heading;
      break;
    }
  }

  if (chosenIndex === -1) {
    return { pageTitle, section: "", text: "", found: false };
  }

  const raw = sectionWithSubsections(sections, chosenIndex);
  const text = cleanProse(raw);
  return { pageTitle, section: chosenName, text, found: text.length > 0 };
}
