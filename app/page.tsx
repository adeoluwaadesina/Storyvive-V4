"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";

type Citation = {
  chunkId: string;
  scope: string;
  season?: number;
  episode?: number;
  title?: string;
  distance: number;
};

type StoryResult = {
  pageTitle: string;
  story: string;
  citations: Citation[];
  generationsUsed: number;
  generationLimit: number;
};

export default function HomePage() {
  const { data: session, status } = useSession();
  const [work, setWork] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StoryResult | null>(null);

  const authed = status === "authenticated" && !!session;
  const canSubmit = work.trim().length > 0 && prompt.trim().length > 0 && !loading;

  async function submit() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work, prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Story generation failed.");
        return;
      }
      setResult(data);
    } catch {
      setError("Story generation temporarily unavailable.");
    } finally {
      setLoading(false);
    }
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
            placeholder="What should happen? e.g. Din Djarin and Grogu find an old imperial outpost..."
            disabled={!authed || loading}
            rows={3}
            className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-4 py-2.5 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
          />
          <button
            onClick={submit}
            disabled={!authed || !canSubmit}
            className="w-full rounded-lg bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 font-medium transition hover:opacity-90 disabled:opacity-40"
          >
            {loading ? "Writing..." : authed ? "Generate story" : "Sign in to generate"}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        {result && (
          <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-brand">{result.pageTitle}</h2>
              <span className="text-xs text-white/40">
                {result.generationsUsed}/{result.generationLimit} generations used
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/90">{result.story}</p>
            {result.citations.length > 0 && (
              <div className="border-t border-white/10 pt-3 text-xs text-white/50">
                <p className="mb-1 font-medium">Sources</p>
                <ul className="space-y-0.5">
                  {result.citations.map((c, i) => (
                    <li key={c.chunkId}>
                      [{i + 1}]{" "}
                      {c.scope === "episode"
                        ? `S${c.season ?? "?"}E${c.episode ?? "?"} "${c.title ?? "untitled"}"`
                        : c.title ?? c.scope}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
