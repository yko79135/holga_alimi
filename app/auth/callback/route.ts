import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Lands here from links in Supabase auth emails (email change confirmation, etc).
 * The SSR client uses PKCE, so the email link carries a `code` query param that
 * has to be exchanged for a session server-side -- without this route the code
 * was never exchanged and the link appeared to do nothing. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/account";
  const redirectTo = new URL(next.startsWith("/") ? next : "/account", url.origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(redirectTo);
  }

  const loginUrl = new URL("/login", url.origin);
  loginUrl.searchParams.set("error", "confirm_failed");
  return NextResponse.redirect(loginUrl);
}
