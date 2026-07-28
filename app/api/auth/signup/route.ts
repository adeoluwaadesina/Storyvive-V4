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
    const message = (err as { code?: string })?.code === "23505"
      ? "An account with that email already exists."
      : "Could not create account.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
