"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { formatAirDate } from "../src/generate/format";

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
  userPrompt: string;
  content: string;
  citations: Citation[];
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

  const [work, setWork] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeStory, setActiveStory] = useState<Story | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [continuePrompt, setContinuePrompt] = useState("");

  const [stories, setStories] = useState<Story[]>([]);
  const [usage, setUsage] = useState<Usage>({});

  const canSubmit = work.trim().length > 0 && prompt.trim().length > 0 && !loading;
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
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work, prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Story generation failed.");
        return;
      }
      setActiveStory(data.story);
      setChapters([data.chapter]);
      setUsage({ generationsUsed: data.generationsUsed, generationLimit: data.generationLimit });
      setWork("");
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
  }

  return (
    <main className="min-h-screen bg-[#0f1419] px-4 py-10 text-white">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <header className="flex items-center justify-between">
          <span className="text-3xl font-semibold text-brand">Storyvive</span>
          {authed ? (
            <div className="flex items-center gap-3 text-sm text-white/60">
              <span>{session.user?.email}</span>
              <button onClick={() => signOut()} className="hover:text-white">
                Sign out
              </button>
            </div>
          ) : status !== "loading" ? (
            <div className="flex items-center gap-3 text-sm">
              <Link href="/signin" className="text-white/70 hover:text-white">
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-lg bg-gradient-to-r from-brand to-brand-light px-3 py-1.5 font-medium hover:opacity-90"
              >
                Sign up
              </Link>
            </div>
          ) : null}
        </header>

        {!authed && status !== "loading" && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            Sign up to start generating canon-faithful stories — it&apos;s free, with a limited number of
            generations per account while we're in early access.
          </div>
        )}

        {authed && stories.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-white/40">Your stories:</span>
            {stories.map((s) => (
              <button
                key={s.id}
                onClick={() => loadStory(s.id)}
                className={`rounded-lg border px-3 py-1 transition ${
                  activeStory?.id === s.id
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-white/10 bg-white/5 text-white/70 hover:border-white/30"
                }`}
              >
                {s.title}
              </button>
            ))}
            {activeStory && (
              <button onClick={newStory} className="text-white/40 hover:text-white">
                + New story
              </button>
            )}
          </div>
        )}

        {!activeStory && (
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <input
              value={work}
              onChange={(e) => setWork(e.target.value)}
              placeholder="Work (e.g. The Mandalorian, Foundation, Dune)"
              disabled={!authed || loading}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-2.5 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
            />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should happen? e.g. Continue the story from where the show/book left off..."
              disabled={!authed || loading}
              rows={3}
              className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-4 py-2.5 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
            />
            <button
              onClick={startStory}
              disabled={!authed || !canSubmit}
              className="w-full rounded-lg bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 font-medium transition hover:opacity-90 disabled:opacity-40"
            >
              {loading ? "Writing..." : authed ? "Start story" : "Sign in to generate"}
            </button>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        {activeStory && chapters.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-brand">{activeStory.title}</h2>
              {usage.generationLimit != null && (
                <span className="text-xs text-white/40">
                  {usage.generationsUsed}/{usage.generationLimit} generations used
                </span>
              )}
            </div>

            {chapters.map((c, idx) => (
              <article
                key={c.id}
                className={`rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur sm:p-8 ${
                  idx > 0 ? "border-t-2 border-t-brand/20" : ""
                }`}
              >
                <header className="mb-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand/70">
                    Chapter {c.chapterIndex}
                  </p>
                  {c.userPrompt && (
                    <p className="mt-1.5 text-sm italic text-white/40">&ldquo;{c.userPrompt}&rdquo;</p>
                  )}
                </header>

                <div className="mx-auto max-w-[68ch] font-serif text-[17px] leading-8 text-white/90">
                  {c.content
                    .split(/\n{2,}/)
                    .filter((p) => p.trim())
                    .map((p, i) => (
                      <p key={i} className="mb-5 last:mb-0">
                        {p}
                      </p>
                    ))}
                </div>

                {c.citations.length > 0 && (
                  <details className="mt-6 border-t border-white/10 pt-4 text-xs text-white/50">
                    <summary className="cursor-pointer select-none font-medium text-white/60 hover:text-white/80">
                      Sources ({c.citations.length})
                    </summary>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {c.citations.map((cite, i) => (
                        <li
                          key={cite.chunkId}
                          className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1"
                        >
                          [{i + 1}]{" "}
                          {cite.scope === "episode"
                            ? `${cite.season != null ? `S${cite.season}E${cite.episode ?? "?"}` : cite.episode != null ? `Episode ${cite.episode}` : "Episode"} "${cite.title ?? "untitled"}"${formatAirDate(cite.airDate) ? ` · ${formatAirDate(cite.airDate)}` : ""}`
                            : cite.title ?? cite.scope}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            ))}

            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
              <textarea
                value={continuePrompt}
                onChange={(e) => setContinuePrompt(e.target.value)}
                placeholder="What happens next?"
                disabled={loading}
                rows={2}
                className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-4 py-2.5 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
              />
              <button
                onClick={continueStory}
                disabled={!canContinue}
                className="w-full rounded-lg bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 font-medium transition hover:opacity-90 disabled:opacity-40"
              >
                {loading ? "Writing..." : "Continue story"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
