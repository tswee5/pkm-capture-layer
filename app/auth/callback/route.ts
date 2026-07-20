import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const providerToken = data.session?.provider_token;
      const providerRefreshToken = data.session?.provider_refresh_token;

      if (providerToken && data.user) {
        await supabase.from("user_integrations").upsert({
          user_id: data.user.id,
          provider: "gmail",
          access_token: providerToken,
          // Google only returns a refresh token on first consent; preserve the
          // existing one on re-auth rather than overwriting it with null.
          ...(providerRefreshToken ? { refresh_token: providerRefreshToken } : {}),
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        }, { onConflict: "user_id,provider", ignoreDuplicates: false });
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/?error=auth`);
}
