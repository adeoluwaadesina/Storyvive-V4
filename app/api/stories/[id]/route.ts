import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth.js";
import { getStory, getChapters } from "../../../../lib/stories.js";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const { id } = await params;
  const story = await getStory(id, userId);
  if (!story) return NextResponse.json({ message: "Story not found." }, { status: 404 });

  const chapters = await getChapters(story.id);
  return NextResponse.json({ story, chapters });
}
