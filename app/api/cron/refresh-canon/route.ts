import { NextResponse } from "next/server";
import { ensureSchema, listIndexes, refreshPage } from "../../../../src/canon/cache.js";

export const maxDuration = 300; // this can touch several works' worth of Wikipedia fetches

// Re-extract any cached work whose canon is older than this, so real
// requests almost always land inside cache.ts's SOFT_FRESH_MS window and can
// skip the live Wikipedia revision check entirely.
const REFRESH_AFTER_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  await ensureSchema();
  const rows = await listIndexes();
  const stale = rows.filter((r) => Date.now() - r.fetchedAt.getTime() > REFRESH_AFTER_MS);

  const results: { pageTitle: string; ok: boolean; error?: string }[] = [];
  for (const row of stale) {
    try {
      await refreshPage(row.pageTitle, row.scope, row.franchise);
      results.push({ pageTitle: row.pageTitle, ok: true });
    } catch (err) {
      results.push({ pageTitle: row.pageTitle, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ checked: rows.length, staleFound: stale.length, results });
}
