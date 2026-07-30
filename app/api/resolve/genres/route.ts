import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth.js";
import { getGenres } from "../../../../src/canon/resolve.js";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const wikidataId = new URL(req.url).searchParams.get("wikidataId")?.trim() ?? "";
  if (!wikidataId) return NextResponse.json({ genres: [] });

  const genres = await getGenres(wikidataId);
  return NextResponse.json({ genres });
}
