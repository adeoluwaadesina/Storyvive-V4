import { NextResponse } from "next/server";
import { createUser } from "../../../../lib/users.js";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ message: "Enter a valid email." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ message: "Password must be at least 8 characters." }, { status: 400 });
  }

  try {
    await createUser(email, password);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      return NextResponse.json({ message: "An account with that email already exists." }, { status: 400 });
    }
    // Log the real cause server-side (visible in Vercel function logs) — the
    // client message stays generic so we don't leak DB/config details.
    console.error("signup failed:", err);
    return NextResponse.json({ message: "Could not create account. Please try again shortly." }, { status: 500 });
  }
}
