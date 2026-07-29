import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth.js";
import { claimGeneration, getUserById, refundGeneration } from "../../../../../lib/users.js";
import { getStory, getState, getLastChapter, addChapter, setState } from "../../../../../lib/stories.js";
import { generateChapter } from "../../../../../src/generate/generate.js";
import { updateState } from "../../../../../src/generate/state.js";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ message: "Sign in to continue this story." }, { status: 401 });

  const { id } = await params;
  const story = await getStory(id, userId);
  if (!story) return NextResponse.json({ message: "Story not found." }, { status: 404 });

  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return NextResponse.json({ message: "A prompt is required." }, { status: 400 });

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
    const [state, lastChapter] = await Promise.all([getState(story.id), getLastChapter(story.id)]);

    const result = await generateChapter({
      work: story.work,
      prompt,
      state,
      previousChapterText: lastChapter?.content,
    });

    const nextIndex = (lastChapter?.chapterIndex ?? 0) + 1;
    const chapter = await addChapter(story.id, nextIndex, prompt, result.story, result.citations);

    const nextState = await updateState(state, prompt, result.story);
    await setState(story.id, nextState);

    return NextResponse.json({
      chapter,
      generationsUsed: claimed.generationsUsed,
      generationLimit: claimed.generationLimit,
    });
  } catch (err) {
    await refundGeneration(userId);
    console.error("chapter generation failed:", err);
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Chapter generation failed." },
      { status: 500 },
    );
  }
}
