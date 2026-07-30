"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.message ?? "Could not create account.");
      setLoading(false);
      return;
    }

    const signInRes = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (signInRes?.error) {
      setError("Account created — sign in to continue.");
      router.push("/signin");
      return;
    }
    router.push("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-[0_18px_50px_-14px_rgba(0,0,0,.12)]">
        <h1 className="text-center font-[family-name:var(--font-logo)] text-2xl font-bold text-[var(--foreground)]">
          Create your account
        </h1>
        <div className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card-muted)] px-4 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--placeholder)] focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min. 8 characters)"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card-muted)] px-4 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--placeholder)] focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Sign up"}
        </button>
        <p className="text-center text-sm text-[var(--muted)]">
          Already have an account?{" "}
          <Link href="/signin" className="text-brand hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
