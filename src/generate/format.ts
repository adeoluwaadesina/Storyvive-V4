// Shared formatting shared by generate.ts and state.ts — pulled out to avoid
// a circular import between the two.

export function formatEpisodeLocation(c: { season?: number; episode?: number }): string {
  if (c.season != null) return `S${c.season}E${c.episode ?? "?"}`;
  if (c.episode != null) return `Episode ${c.episode}`;
  return "Episode";
}
