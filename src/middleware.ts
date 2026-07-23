import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/pay"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return true;
  }
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/icon")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/manifest.json") return true;
  if (pathname.startsWith("/api/")) return true; // APIs self-authorize
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Always refresh/validate the session so mobile + PWA cookies stay alive.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isPublicPath(pathname)) {
    if (pathname.startsWith("/login") && user) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return response;
  }

  if (!user) {
    const url = request.nextUrl.clone();
    const nextTarget = `${pathname}${request.nextUrl.search || ""}`;
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", nextTarget);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon-.*\\.svg|manifest\\.json).*)",
  ],
};
