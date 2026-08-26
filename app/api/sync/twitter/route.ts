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
  // recent batch and rely on dedup below to skip anything already stored.
  const isFirstSync = !integration?.last_synced_at;
  const { likes, bookmarks } = await fetchTwitterArticles(accessToken, {
    likesLimit: isFirstSync ? 100 : 25,
    bookmarksLimit: isFirstSync ? 50 : 25,
  });

  // Dedup is scoped per (link, tweet_type) — the same tweet can legitimately be
  // both liked and bookmarked, and each should be able to land in its own feed.
  const { data: existing } = await supabase
    .from("articles")
    .select("link, tweet_type")
    .eq("source", "twitter");
  const existingKeys = new Set((existing ?? []).map((a) => `${a.link}::${a.tweet_type}`));

  let inserted = 0;
  let skipped = 0;

  for (const tweet of [...likes, ...bookmarks]) {
    const key = `${tweet.link}::${tweet.tweetType}`;
    if (existingKeys.has(key)) {
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
      tweet_type: tweet.tweetType,
      tweet_author_name: tweet.authorName,
      tweet_author_handle: tweet.authorHandle,
      tweet_author_avatar_url: tweet.authorAvatarUrl,
      tweet_posted_at: tweet.postedAt,
    });

    if (error) {
      skipped++;
    } else {
      existingKeys.add(key);
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
