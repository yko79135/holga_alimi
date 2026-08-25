import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "./config";

/** True when a request carries the payload of a Supabase auth email link (PKCE `code`, a
 * `token_hash` + `type` pair, or a GoTrue error). */
function carriesAuthLinkPayload(params: URLSearchParams) {
  return params.has("code") || (params.has("token_hash") && params.has("type")) || params.has("error_description");
}

export async function updateSession(request: NextRequest) {
  // Supabase only honours `emailRedirectTo` when the exact URL is in the project's Redirect URLs
  // allowlist; with an empty allowlist it falls back to the Site URL, so the confirmation link
  // lands on "/" (which redirects to /dashboard and drops the query) instead of /auth/callback and
  // the link looks dead. Forward any auth payload to the callback route wherever it lands, so the
  // flow does not depend on a dashboard setting this app cannot configure.
  if (
    request.method === "GET" &&
    !request.nextUrl.pathname.startsWith("/auth/callback") &&
    !request.nextUrl.pathname.startsWith("/api/") &&
    carriesAuthLinkPayload(request.nextUrl.searchParams)
  ) {
    const callbackUrl = request.nextUrl.clone();
    callbackUrl.pathname = "/auth/callback";
    if (!callbackUrl.searchParams.has("next")) {
      callbackUrl.searchParams.set("next", request.nextUrl.pathname === "/" ? "/account" : request.nextUrl.pathname);
    }
    return NextResponse.redirect(callbackUrl);
  }

  let response = NextResponse.next({ request });
  let supabaseConfig: ReturnType<typeof getSupabasePublicConfig>;

  try {
    supabaseConfig = getSupabasePublicConfig();
  } catch {
    return response;
  }

  const { url, key } = supabaseConfig;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const isPublic = pathname.startsWith("/login") || pathname.startsWith("/signup") || pathname.startsWith("/api/signup") || pathname.startsWith("/auth/callback");

  if (!data.user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    // Preserve where the request was headed (e.g. a push notification's ?view=parent&notice=<id>
    // deep link) so the login form can send the user straight there instead of a bare dashboard.
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (data.user && (pathname === "/login" || pathname.startsWith("/signup"))) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}
