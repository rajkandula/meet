import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session";

export function middleware(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  // "/" is absent: it serves the public landing page to signed-out visitors
  // (and the dashboard to signed-in ones — see app/page.tsx).
  // /room/:path* is deliberately absent: invite links promise "anyone with it
  // can join", and the token API supports guests — the meeting room must not
  // bounce signed-out invitees to the login page.
  matcher: ["/meetings", "/recordings", "/contacts", "/profile"],
};
