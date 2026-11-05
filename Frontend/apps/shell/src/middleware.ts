import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that don't require authentication
const AUTH_PATHS = ["/auth/signin", "/auth/signup"] as const;

// Public routes that should be accessible without authentication.
// `/invite/*` is the primary public invite surface.
// `/core/invite/*` remains public for compatibility with already-issued links.
const PUBLIC_ROUTES = [
  // The recipient has no account yet — creating one is the point — so these
  // surfaces authenticate on the invitation credential alone.
  { path: "/activate-invitation", descendants: false },

  // Where a sign-in provider sends the browser back (B-191): it collects the
  // session, so it can't require one.
  { path: "/auth/sso/complete", descendants: false },

  // An additional administrator invited by an existing one, and a Platform
  // recovery for a tenant that has lost every administrator. Both establish the
  // account they sign in with, so requiring a session first would make them
  // impossible to complete.
  { path: "/accept-administrator-invitation", descendants: false },
  { path: "/recover-administrator-access", descendants: false },
  { path: "/invite", descendants: true }, // Primary workforce invite surface
  { path: "/core/invite", descendants: true }, // Compatibility for issued links
  { path: "/interview/candidate/start", descendants: true },
  { path: "/learning/verify", descendants: true },
] as const;

export function matchesRouteSegment(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(({ path, descendants }) =>
    descendants ? matchesRouteSegment(pathname, path) : pathname === path
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Client-writable compatibility hint only. It avoids a server redirect when a
  // browser likely has a session; each MFE and every backend still validates the
  // real session and authority before rendering or serving protected data.
  const sessionHint = request.cookies.get("ey_hr_authenticated")?.value === "true";

  // If authenticated and trying to access auth pages, redirect to home
  if (
    sessionHint &&
    AUTH_PATHS.some((path) => matchesRouteSegment(pathname, path))
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Allow auth pages for unauthenticated users
  if (AUTH_PATHS.some((path) => matchesRouteSegment(pathname, path))) {
    return NextResponse.next();
  }

  // Allow public paths without authentication (e.g., invite acceptance)
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Allow Next.js internals & static assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/platform/_next") ||
    pathname.startsWith("/performance/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to sign in
  if (!sessionHint) {
    const signInUrl = new URL("/auth/signin", request.url);
    signInUrl.searchParams.set("callbackUrl", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except Next.js internals and static files.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
