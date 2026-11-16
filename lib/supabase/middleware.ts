import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const isAuthRoute =
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname.startsWith("/auth") ||
    // Token-authenticated, not session-authenticated — see app/api/capture/route.ts
    // and app/api/mcp/route.ts.
    request.nextUrl.pathname === "/api/capture" ||
    request.nextUrl.pathname === "/api/mcp" ||
    // The OAuth endpoints authenticate the resource owner themselves (via
    // the login form in app/api/mcp/oauth/authorize), and the discovery
    // metadata routes have no auth at all by design (RFC 8414 / RFC 9728).
    request.nextUrl.pathname.startsWith("/api/mcp/oauth/") ||
    request.nextUrl.pathname.startsWith("/.well-known/");

  if (!data.user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  if (data.user && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
