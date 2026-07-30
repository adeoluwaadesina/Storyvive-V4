"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("Invalid email or password.");
      return;
    }
    router.push("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fafaf8] px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl border border-black/10 bg-white p-8 shadow-[0_18px_50px_-14px_rgba(0,0,0,.12)]">
        <h1 className="text-center font-serif text-2xl font-semibold text-[#14181c]">Welcome back</h1>
        <div className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-black/10 bg-black/[0.02] px-4 py-2.5 text-sm text-[#14181c] placeholder:text-black/35 focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-lg border border-black/10 bg-black/[0.02] px-4 py-2.5 text-sm text-[#14181c] placeholder:text-black/35 focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
        <p className="text-center text-sm text-black/50">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-brand hover:underline">
            Sign up
          </Link>
        </p>
      </form>
    </main>
  );
}
