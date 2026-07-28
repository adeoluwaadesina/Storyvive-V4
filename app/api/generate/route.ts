import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth.js";
import { claimGeneration, getUserById, refundGeneration } from "../../../lib/users.js";
import { generateStory } from "../../../src/generate/generate.js";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ message: "Sign in to generate a story." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const work = typeof body?.work === "string" ? body.work.trim() : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!work || !prompt) {
    return NextResponse.json({ message: "Both a work title and a prompt are required." }, { status: 400 });
  }

  const claimed = await claimGeneration(userId);
  if (!claimed) {
    const user = await getUserById(userId);
    return NextResponse.json(
      {
        message: `You've used all ${user?.generationLimit ?? "your"} free generations.`,
        generationsUsed: user?.generationsUsed,
        generationLimit: user?.generationLimit,
      },
      { status: 429 },
    );
  }

  try {
    const result = await generateStory({ work, prompt });
    return NextResponse.json({
      ...result,
      generationsUsed: claimed.generationsUsed,
      generationLimit: claimed.generationLimit,
    });
  } catch (err) {
    await refundGeneration(userId);
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Story generation failed." },
      { status: 500 },
    );
  }
}
