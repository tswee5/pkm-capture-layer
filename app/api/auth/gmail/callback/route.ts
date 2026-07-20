import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  const cookieStore = await cookies();
  const savedState = cookieStore.get("gmail_oauth_state")?.value;

  if (!code || !state || state !== savedState) {
    return NextResponse.redirect(`${appUrl}/dashboard?error=gmail_auth`);
  }

  cookieStore.delete("gmail_oauth_state");

  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.redirect(`${appUrl}/?error=auth`);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${appUrl}/api/auth/gmail/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    console.error("Gmail token exchange failed:", await tokenRes.text());
    return NextResponse.redirect(`${appUrl}/dashboard?error=gmail_token`);
  }

  const tokens: {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  } = await tokenRes.json();

  await supabase.from("user_integrations").upsert(
    {
      user_id: userData.user.id,
      provider: "gmail",
      access_token: tokens.access_token,
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    },
    { onConflict: "user_id,provider", ignoreDuplicates: false },
  );

  return NextResponse.redirect(`${appUrl}/dashboard`);
}
