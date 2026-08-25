import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchTwitterArticles, getValidTwitterAccessToken } from "@/lib/twitter";

export async function POST() {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let accessToken: string;
  try {
    accessToken = await getValidTwitterAccessToken(userData.user.id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Twitter not connected" },
      { status: 400 },
    );
  }

  const { data: integration } = await supabase
    .from("user_integrations")
    .select("last_synced_at")
    .eq("user_id", userData.user.id)
    .eq("provider", "twitter")
    .single();

  // First sync pulls a deliberately capped backfill so we don't bloat storage
  // with someone's entire likes/bookmarks history; later syncs pull a smaller
  // recent batch and rely on link-based dedup below to skip anything already stored.
  const isFirstSync = !integration?.last_synced_at;
  const tweets = await fetchTwitterArticles(accessToken, {
    likesLimit: isFirstSync ? 100 : 25,
    bookmarksLimit: isFirstSync ? 50 : 25,
  });

  const { data: existing } = await supabase.from("articles").select("link");
  const existingLinks = new Set((existing ?? []).map((a) => a.link));

  let inserted = 0;
  let skipped = 0;

  for (const tweet of tweets) {
    if (existingLinks.has(tweet.link)) {
      skipped++;
      continue;
    }

    const { error } = await supabase.from("articles").insert({
      user_id: userData.user.id,
      source: "twitter",
      link: tweet.link,
      headline: tweet.headline,
      summary: tweet.summary,
      status: "pending",
    });

    if (error) {
      skipped++;
    } else {
      existingLinks.add(tweet.link);
      inserted++;
    }
  }

  await supabase
    .from("user_integrations")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("user_id", userData.user.id)
    .eq("provider", "twitter");

  return NextResponse.json({ inserted, skipped });
}
