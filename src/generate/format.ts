// Shared formatting shared by generate.ts and state.ts — pulled out to avoid
// a circular import between the two.

export function formatEpisodeLocation(c: { season?: number; episode?: number }): string {
  if (c.season != null) return `S${c.season}E${c.episode ?? "?"}`;
  if (c.episode != null) return `Episode ${c.episode}`;
  return "Episode";
}

/** "2018-06-01" -> "Jun 2018". Falls back to the raw string if unparseable. */
export function formatAirDate(airDate?: string): string | undefined {
  if (!airDate) return undefined;
  const d = new Date(airDate);
  if (Number.isNaN(d.getTime())) return airDate;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
