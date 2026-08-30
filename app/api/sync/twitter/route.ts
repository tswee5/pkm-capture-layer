import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchTwitterArticles, getValidTwitterAccessToken } from "@/lib/twitter";

export async function POST() {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = userData.user;

  let accessToken: string;
  try {
    accessToken = await getValidTwitterAccessToken(user.id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Twitter not connected" },
      { status: 400 },
    );
  }

  const { data: integration } = await supabase
    .from("user_integrations")
    .select("last_synced_at")
    .eq("user_id", user.id)
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

  // order_index (not created_at/insertion timing) drives display order within each
  // tab — ascending, so the smallest value shows first. Every new sync's tweets need
  // to rank above (i.e. get smaller values than) all previously-stored tweets of the
  // same type, while preserving their own most-recent-first order within the batch:
  // the first (most recent) tweet in the list gets the smallest value of the batch,
  // and each subsequent (less recent) tweet gets a larger one.
  async function currentMinOrderIndex(tweetType: "like" | "bookmark"): Promise<number> {
    const { data } = await supabase
      .from("articles")
      .select("order_index")
      .eq("user_id", user.id)
      .eq("source", "twitter")
      .eq("tweet_type", tweetType)
      .order("order_index", { ascending: true })
      .limit(1);
    return data?.[0]?.order_index ?? 0;
  }

  let inserted = 0;
  let skipped = 0;

  for (const tweetList of [likes, bookmarks]) {
    let nextOrderIndex =
      tweetList.length > 0
        ? (await currentMinOrderIndex(tweetList[0].tweetType)) - tweetList.length
        : 0;

    for (const tweet of tweetList) {
      const key = `${tweet.link}::${tweet.tweetType}`;
      if (existingKeys.has(key)) {
        skipped++;
        nextOrderIndex++;
        continue;
      }

      const { error } = await supabase.from("articles").insert({
        user_id: user.id,
        source: "twitter",
        link: tweet.link,
        headline: tweet.headline,
        summary: tweet.summary,
        status: "pending",
        tweet_id: tweet.tweetId,
        tweet_type: tweet.tweetType,
        tweet_author_name: tweet.authorName,
        tweet_author_handle: tweet.authorHandle,
        tweet_author_avatar_url: tweet.authorAvatarUrl,
        tweet_posted_at: tweet.postedAt,
        order_index: nextOrderIndex,
      });

      if (error) {
        skipped++;
      } else {
        existingKeys.add(key);
        inserted++;
      }
      nextOrderIndex++;
    }
  }

  await supabase
    .from("user_integrations")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("provider", "twitter");

  return NextResponse.json({ inserted, skipped });
}
