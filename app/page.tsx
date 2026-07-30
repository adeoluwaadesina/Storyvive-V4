"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { formatAirDate } from "../src/generate/format";
import TitleSearch, { type TitleCandidate } from "./components/TitleSearch";
import StoryStateGraph, { type StoryStateLike } from "./components/StoryStateGraph";

type Citation = {
  chunkId: string;
  scope: string;
  season?: number;
  episode?: number;
  title?: string;
  airDate?: string;
  distance: number;
};

type Chapter = {
  id: string;
  chapterIndex: number;
  title: string;
  userPrompt: string;
  content: string;
  citations: Citation[];
  stateBefore: StoryStateLike;
  stateAfter: StoryStateLike;
};

type Story = {
  id: string;
  work: string;
  title: string;
  updatedAt: string;
};

type Usage = { generationsUsed?: number; generationLimit?: number };

export default function HomePage() {
  const { data: session, status } = useSession();
  const authed = status === "authenticated" && !!session;

  const [titleCandidate, setTitleCandidate] = useState<TitleCandidate | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeStory, setActiveStory] = useState<Story | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [continuePrompt, setContinuePrompt] = useState("");
  const [newlyAddedChapterId, setNewlyAddedChapterId] = useState<string | null>(null);
  const [railExpanded, setRailExpanded] = useState(true);

  const [stories, setStories] = useState<Story[]>([]);
  const [usage, setUsage] = useState<Usage>({});

  const canSubmit = !!titleCandidate && prompt.trim().length > 0 && !loading;
  const canContinue = continuePrompt.trim().length > 0 && !loading;

  useEffect(() => {
    if (!authed) return;
    fetch("/api/stories")
      .then((r) => r.json())
      .then((d) => setStories(d.stories ?? []))
      .catch(() => {});
  }, [authed, activeStory?.id]);

  async function loadStory(id: string) {
    setLoading(true);
    setError(null);
    setNewlyAddedChapterId(null);
    try {
      const res = await fetch(`/api/stories/${id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not load story.");
        return;
      }
      setActiveStory(data.story);
      setChapters(data.chapters ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function startStory() {
    if (!canSubmit || !titleCandidate) return;
    setLoading(true);
    setError(null);
    setNewlyAddedChapterId(null);
    try {
      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work: titleCandidate.pageTitle, prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Story generation failed.");
        return;
      }
      setActiveStory(data.story);
      setChapters([data.chapter]);
      setUsage({ generationsUsed: data.generationsUsed, generationLimit: data.generationLimit });
      setTitleCandidate(null);
      setPrompt("");
    } catch {
      setError("Story generation temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }

  async function continueStory() {
    if (!canContinue || !activeStory) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stories/${activeStory.id}/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: continuePrompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Chapter generation failed.");
        return;
      }
      setChapters((prev) => [...prev, data.chapter]);
      setNewlyAddedChapterId(data.chapter.id);
      setUsage({ generationsUsed: data.generationsUsed, generationLimit: data.generationLimit });
      setContinuePrompt("");
    } catch {
      setError("Chapter generation temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }

  function newStory() {
    setActiveStory(null);
    setChapters([]);
    setError(null);
    setNewlyAddedChapterId(null);
  }

  return (
    <main className="min-h-screen bg-[#fafaf8] px-4 py-10 text-[#14181c]">
      <div className={`mx-auto flex flex-col gap-8 ${activeStory ? "max-w-5xl" : "max-w-2xl"}`}>
        <header className="flex items-center justify-between">
          <span className="font-serif text-3xl font-semibold text-brand">Storyvive</span>
          {authed ? (
            <div className="flex items-center gap-3 text-sm text-black/50">
              <span>{session.user?.email}</span>
              <button onClick={() => signOut()} className="hover:text-black">
                Sign out
              </button>
            </div>
          ) : status !== "loading" ? (
            <div className="flex items-center gap-3 text-sm">
              <Link href="/signin" className="text-black/60 hover:text-black">
                Sign in
              </Link>
              <Link href="/signup" className="rounded-lg bg-brand px-3 py-1.5 font-medium text-white hover:opacity-90">
                Sign up
              </Link>
            </div>
          ) : null}
        </header>

        {!authed && status !== "loading" && (
          <div className="rounded-xl border border-black/10 bg-white p-4 text-sm text-black/60">
            Sign up to start generating canon-faithful stories — it&apos;s free, with a limited number of
            generations per account while we're in early access.
          </div>
        )}

        {authed && stories.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-black/40">Your stories:</span>
            {stories.map((s) => (
              <button
                key={s.id}
                onClick={() => loadStory(s.id)}
                className={`rounded-lg border px-3 py-1 transition ${
                  activeStory?.id === s.id
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-black/10 bg-white text-black/60 hover:border-black/25"
                }`}
              >
                {s.title}
              </button>
            ))}
            {activeStory && (
              <button onClick={newStory} className="text-black/40 hover:text-black">
                + New story
              </button>
            )}
          </div>
        )}

        {!activeStory && (
          <div className="space-y-5 rounded-2xl border border-black/10 bg-white p-6 shadow-[0_18px_50px_-14px_rgba(0,0,0,.08)]">
            <div>
              <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-black/40">
                Title
              </label>
              <TitleSearch value={titleCandidate} onChange={setTitleCandidate} disabled={!authed || loading} />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-black/40">
                What should happen next?
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Continue the story from where the show/book left off…"
                disabled={!authed || loading}
                rows={3}
                className="w-full resize-none rounded-lg border border-black/10 bg-black/[0.02] px-4 py-2.5 text-sm placeholder:text-black/35 focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
              />
            </div>
            <button
              onClick={startStory}
              disabled={!authed || !canSubmit}
              className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-40"
            >
              {loading ? "Writing…" : authed ? "Start story" : "Sign in to generate"}
            </button>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {activeStory && chapters.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-lg font-semibold text-brand">{activeStory.title}</h2>
              <div className="flex items-center gap-4">
                {usage.generationLimit != null && (
                  <span className="text-xs text-black/40">
                    {usage.generationsUsed}/{usage.generationLimit} generations used
                  </span>
                )}
                <button
                  onClick={() => setRailExpanded((v) => !v)}
                  className="text-xs font-medium text-black/50 hover:text-black"
                >
                  {railExpanded ? "Hide story state ›" : "‹ Show story state"}
                </button>
              </div>
            </div>

            {chapters.map((c, idx) => (
              <article
                key={c.id}
                className={`rounded-2xl border border-black/10 bg-white p-6 shadow-[0_10px_30px_-16px_rgba(0,0,0,.08)] sm:p-8 ${
                  idx > 0 ? "border-t-2 border-t-brand/15" : ""
                }`}
              >
                <div className={`grid gap-8 ${railExpanded ? "sm:grid-cols-[1fr_240px]" : "sm:grid-cols-1"}`}>
                  <div>
                    <header className="mb-6 border-b border-black/[0.08] pb-3">
                      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-brand/70">
                        Chapter {c.chapterIndex}
                      </p>
                      <h3 className="mt-1 font-serif text-2xl font-semibold">{c.title || activeStory.title}</h3>
                      {c.userPrompt && <p className="mt-1.5 text-sm italic text-black/40">You asked: &ldquo;{c.userPrompt}&rdquo;</p>}
                    </header>

                    <div className="max-w-[68ch] font-serif text-[17px] leading-8 text-[#1d2226]">
                      {c.content
                        .split(/\n{2,}/)
                        .filter((p) => p.trim())
                        .map((p, i) => (
                          <p key={i} className="mb-5 last:mb-0">
                            {p}
                          </p>
                        ))}
                    </div>
                  </div>

                  {railExpanded && (
                    <div className="border-l border-black/[0.08] pl-6">
                      <p className="mb-2.5 font-mono text-[10.5px] uppercase tracking-wider text-black/40">
                        Story state
                      </p>
                      <StoryStateGraph
                        state={c.stateBefore}
                        previousState={
                          c.id === newlyAddedChapterId && idx > 0 ? chapters[idx - 1].stateBefore : undefined
                        }
                      />

                      {c.citations.length > 0 && (
                        <div className="mt-4 border-t border-black/[0.08] pt-3">
                          <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-black/40">
                            Sources
                          </p>
                          <ul className="space-y-1.5 text-[11px] text-black/55">
                            {c.citations.map((cite, i) => (
                              <li key={cite.chunkId}>
                                <span className="mr-1 font-mono font-bold text-brand">[{i + 1}]</span>
                                {cite.scope === "episode"
                                  ? `${cite.season != null ? `S${cite.season}E${cite.episode ?? "?"}` : cite.episode != null ? `Episode ${cite.episode}` : "Episode"} "${cite.title ?? "untitled"}"${formatAirDate(cite.airDate) ? ` · ${formatAirDate(cite.airDate)}` : ""}`
                                  : cite.title ?? cite.scope}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))}

            <div className="space-y-3 rounded-2xl border border-black/10 bg-white p-6 shadow-[0_10px_30px_-16px_rgba(0,0,0,.08)]">
              <textarea
                value={continuePrompt}
                onChange={(e) => setContinuePrompt(e.target.value)}
                placeholder="What happens next?"
                disabled={loading}
                rows={2}
                className="w-full resize-none rounded-lg border border-black/10 bg-black/[0.02] px-4 py-2.5 text-sm placeholder:text-black/35 focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
              />
              <button
                onClick={continueStory}
                disabled={!canContinue}
                className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-40"
              >
                {loading ? "Writing…" : "Continue story"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
