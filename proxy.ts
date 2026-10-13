import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // manifest.webmanifest and sw.js are public static files the browser fetches before anyone
    // logs in. Sending them through the login check answered them with the login page, so an
    // iPhone that added the app from the login screen got no manifest: the icon was named after
    // the page title and opened as a Safari bookmark with an address bar, which never gets push.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest$|sw.js$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
