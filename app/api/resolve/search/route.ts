import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth.js";
import { searchCandidates } from "../../../../src/canon/resolve.js";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ candidates: [] });

  try {
    const candidates = await searchCandidates(q, 6);
    return NextResponse.json({ candidates });
  } catch (err) {
    console.error("title search failed:", err);
    return NextResponse.json({ candidates: [] });
  }
}
