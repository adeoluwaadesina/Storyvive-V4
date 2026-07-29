import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth.js";
import { claimGeneration, getUserById, refundGeneration } from "../../../lib/users.js";
import { createStory, listStories, addChapter, setState } from "../../../lib/stories.js";
import { getCanon } from "../../../src/canon/cache.js";
import { generateChapter } from "../../../src/generate/generate.js";
import { seedStateFromCanon, updateState } from "../../../src/generate/state.js";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const stories = await listStories(userId);
  return NextResponse.json({ stories });
}

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
    // Resolve once here so the story is titled/keyed on the canonical page,
    // and continuity state is seeded from the real work before writing.
    const canon = await getCanon(work);
    const seeded = await seedStateFromCanon(canon.pageTitle);

    const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim() : canon.pageTitle;
    const story = await createStory(userId, canon.pageTitle, title);

    const result = await generateChapter({ work: canon.pageTitle, prompt, state: seeded });
    const chapter = await addChapter(story.id, 1, prompt, result.story, result.citations);

    const nextState = await updateState(seeded, prompt, result.story);
    await setState(story.id, nextState);

    return NextResponse.json({
      story,
      chapter,
      pageTitle: result.pageTitle,
      generationsUsed: claimed.generationsUsed,
      generationLimit: claimed.generationLimit,
    });
  } catch (err) {
    await refundGeneration(userId);
    console.error("story creation failed:", err);
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Story generation failed." },
      { status: 500 },
    );
  }
}
