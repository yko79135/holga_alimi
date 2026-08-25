import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authNoticeFromError, type AuthNoticeCode } from "@/lib/auth/notices";

export const dynamic = "force-dynamic";

/** Lands here from links in Supabase auth emails (email change confirmation, etc).
 *
 * Three different things can arrive at this route and only one of them carries a `code`:
 * - `?code=...` -- the SSR client uses PKCE, so this has to be exchanged for a session here.
 * - no `code`, no error -- with "Secure email change" enabled Supabase mails BOTH the old and
 *   the new address, and accepting the first of the two links returns here with only a
 *   `message`. That is a half-finished change, not a failure.
 * - `?error=...` / `?error_code=...` -- expired or already-used link.
 * Treating every code-less landing as a failure (as this route used to) made a successful first
 * confirmation look like a dead link, so each case gets its own `?notice=` for the UI to show. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error_code") || url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description") || "";
  const next = url.searchParams.get("next") || "/account";
  const nextPath = next.startsWith("/") && !next.startsWith("//") ? next : "/account";

  const supabase = await createClient();
  let notice: AuthNoticeCode;

  if (errorParam) {
    notice = authNoticeFromError(`${errorParam} ${errorDescription}`);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    notice = error ? authNoticeFromError(error.message) : "email_change_done";
  } else {
    // Supabase accepted one side of a two-step email change; the other link is still pending.
    notice = "email_change_partial";
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only a signed-in browser can render /account -- otherwise the proxy would bounce the
  // redirect to /login and drop the notice, so send it straight to /login instead.
  const redirectTo = new URL(user ? nextPath : "/login", url.origin);
  redirectTo.searchParams.set("notice", notice);
  return NextResponse.redirect(redirectTo);
}
