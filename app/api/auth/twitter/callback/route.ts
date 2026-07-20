import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const cookieStore = await cookies();
  const storedVerifier = cookieStore.get("twitter_code_verifier")?.value;
  const storedState = cookieStore.get("twitter_oauth_state")?.value;

  if (!code || !state || state !== storedState || !storedVerifier) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?error=twitter_auth`);
  }

  const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: process.env.TWITTER_CLIENT_ID!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/twitter/callback`,
      code_verifier: storedVerifier,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?error=twitter_token`);
  }

  const tokens: { access_token: string; refresh_token?: string; expires_in?: number } =
    await tokenRes.json();

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=auth`);
  }

  await supabase.from("user_integrations").upsert({
    user_id: userData.user.id,
    provider: "twitter",
    access_token: tokens.access_token,
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    expires_at: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null,
  }, { onConflict: "user_id,provider", ignoreDuplicates: false });

  cookieStore.delete("twitter_code_verifier");
  cookieStore.delete("twitter_oauth_state");

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard`);
}
