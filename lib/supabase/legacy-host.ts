import { NextResponse, type NextRequest } from "next/server";

/**
 * The portal moved from holga-alimi2.vercel.app to stonelantern.vercel.app.
 *
 * The old address keeps working for anyone who already uses the app on it (their login,
 * home-screen app and push subscription all belong to that address and can't be moved), but
 * shows nothing at all — not even the login page — to anyone it doesn't recognise.
 *
 *   signed in on the old address            → served as usual, and the device is marked as known
 *   signed out, but a known device           → sent to the same page on the new address
 *   (marker cookie, or a leftover Supabase     (e.g. after logging out or an expired session)
 *    session cookie)
 *   invite link / email sign-in link          → sent to the new address / handled as usual
 *   anyone else                               → plain 404
 */
export const LEGACY_HOST = "holga-alimi2.vercel.app";
export const CANONICAL_ORIGIN = "https://stonelantern.vercel.app";

const KNOWN_DEVICE_COOKIE = "holga_known_device";
// Chrome caps cookie lifetimes at 400 days; every signed-in visit pushes it forward again.
const KNOWN_DEVICE_MAX_AGE = 400 * 24 * 60 * 60;
const SUPABASE_AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export function isLegacyHost(request: NextRequest) {
  const host = (request.headers.get("host") || request.nextUrl.host).toLowerCase().split(":")[0];
  return host === LEGACY_HOST;
}

/** Read before Supabase touches the cookies: a failed refresh clears the session cookie. */
export function isKnownDevice(request: NextRequest) {
  return request.cookies.getAll().some(({ name }) => name === KNOWN_DEVICE_COOKIE || SUPABASE_AUTH_COOKIE.test(name));
}

export function markKnownDevice(response: NextResponse) {
  response.cookies.set(KNOWN_DEVICE_COOKIE, "1", {
    maxAge: KNOWN_DEVICE_MAX_AGE,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}

export function redirectToCanonical(request: NextRequest) {
  const target = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, CANONICAL_ORIGIN);
  return NextResponse.redirect(target, 308);
}

export function notFound() {
  return new NextResponse("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" },
  });
}

/** What a signed-out request to the old address gets. */
export function legacySignedOutResponse(request: NextRequest, knownDevice: boolean) {
  const { pathname, searchParams } = request.nextUrl;
  // Someone holding an invite link that was sent out with the old address.
  const carriesInvite = pathname.startsWith("/signup") && searchParams.has("token");
  if (pathname.startsWith("/api/")) return notFound();
  if (knownDevice || carriesInvite) return redirectToCanonical(request);
  return notFound();
}
