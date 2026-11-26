import { NextResponse, type NextRequest } from "next/server";

/**
 * The portal moved from holga-alimi2.vercel.app to stonelantern.vercel.app.
 *
 * The old address keeps working for anyone signed in on it (their login, home-screen app and
 * push subscription all belong to that address and can't be moved). Everyone else is sent to
 * the same page on the new address:
 *
 *   signed in on the old address        → served as usual
 *   email sign-in link                  → handled as usual
 *   anyone else (incl. invite links)    → sent to the same page on the new address
 *   signed-out /api/ request            → plain 404
 *
 * Unrecognised visitors used to get a bare 404, but that also caught signed-out parents and
 * iPhone home-screen apps (which keep their own cookies apart from Safari): they opened the app
 * and saw only "Not Found". The new address shows the login page to anyone anyway.
 */
export const LEGACY_HOST = "holga-alimi2.vercel.app";
export const CANONICAL_ORIGIN = "https://stonelantern.vercel.app";

export function isLegacyHost(request: NextRequest) {
  const host = (request.headers.get("host") || request.nextUrl.host).toLowerCase().split(":")[0];
  return host === LEGACY_HOST;
}

function redirectToCanonical(request: NextRequest) {
  const target = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, CANONICAL_ORIGIN);
  return NextResponse.redirect(target, 308);
}

function notFound() {
  return new NextResponse("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" },
  });
}

/** What a signed-out request to the old address gets. */
export function legacySignedOutResponse(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) return notFound();
  return redirectToCanonical(request);
}
