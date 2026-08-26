import { createClient } from "@/lib/supabase/server";

interface TwitterToken {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

async function refreshTwitterToken(refreshToken: string): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const credentials = Buffer.from(
    `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`,
  ).toString("base64");

  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) throw new Error(`Twitter token refresh failed: ${res.status}`);
  return res.json();
}

export async function getValidTwitterAccessToken(userId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_integrations")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .eq("provider", "twitter")
    .single();

  if (error || !data) throw new Error("Twitter is not connected for this user");

  const token = data as TwitterToken;
  const expiresAt = token.expires_at ? new Date(token.expires_at).getTime() : 0;
  const isExpired = expiresAt > 0 && expiresAt < Date.now() + 60 * 1000;

  if (!isExpired) return token.access_token;

  if (!token.refresh_token) throw new Error("Twitter token expired and no refresh token stored");

  const refreshed = await refreshTwitterToken(token.refresh_token);
  await supabase
    .from("user_integrations")
    .update({
      access_token: refreshed.access_token,
      ...(refreshed.refresh_token ? { refresh_token: refreshed.refresh_token } : {}),
      ...(refreshed.expires_in
        ? { expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString() }
        : {}),
    })
    .eq("user_id", userId)
    .eq("provider", "twitter");

  return refreshed.access_token;
}

export interface TweetArticle {
  tweetId: string;
  link: string;
  headline: string;
  summary: string;
  tweetType: "like" | "bookmark";
  authorName: string | null;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  postedAt: string | null;
}

interface TweetEntity {
  urls?: { expanded_url: string; display_url: string; url: string }[];
}

interface Tweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  entities?: TweetEntity;
}

interface TwitterUser {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
}

async function fetchTwitterUserId(accessToken: string): Promise<string> {
  const res = await fetch("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch Twitter user ID: ${res.status}`);
  const data: { data: { id: string } } = await res.json();
  return data.data.id;
}

function extractArticleFromTweet(
  tweet: Tweet,
  tweetType: "like" | "bookmark",
  authorsById: Map<string, TwitterUser>,
): TweetArticle {
  const urls = tweet.entities?.urls ?? [];
  const externalUrl = urls.find(
    (u) => !u.expanded_url.includes("twitter.com") && !u.expanded_url.includes("x.com") && !u.expanded_url.includes("t.co"),
  );

  const link = externalUrl?.expanded_url ?? `https://twitter.com/i/web/status/${tweet.id}`;
  const cleanText = tweet.text.replace(/https?:\/\/t\.co\/\S+/g, "").trim();
  // A media-only tweet (no remaining text after stripping the t.co link) still gets a
  // meaningful card once author name/avatar are shown, so this placeholder just needs
  // to not look like a broken ID in the headline slot.
  const headline = cleanText.slice(0, 120) || "(media tweet)";
  const summary = cleanText;

  const author = tweet.author_id ? authorsById.get(tweet.author_id) : undefined;

  return {
    tweetId: tweet.id,
    link,
    headline,
    summary,
    tweetType,
    authorName: author?.name ?? null,
    authorHandle: author?.username ?? null,
    authorAvatarUrl: author?.profile_image_url ?? null,
    postedAt: tweet.created_at ?? null,
  };
}

async function fetchTweets(
  accessToken: string,
  userId: string,
  endpoint: "liked_tweets" | "bookmarks",
  maxResults = 25,
): Promise<{ tweets: Tweet[]; authorsById: Map<string, TwitterUser> }> {
  const base =
    endpoint === "liked_tweets"
      ? `https://api.twitter.com/2/users/${userId}/liked_tweets`
      : `https://api.twitter.com/2/users/${userId}/bookmarks`;

  const url = new URL(base);
  url.searchParams.set("tweet.fields", "entities,created_at,author_id");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "name,username,profile_image_url");
  url.searchParams.set("max_results", String(maxResults));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twitter ${endpoint} request failed (${res.status}): ${body}`);
  }

  const data: { data?: Tweet[]; includes?: { users?: TwitterUser[] } } = await res.json();
  const authorsById = new Map((data.includes?.users ?? []).map((u) => [u.id, u]));
  return { tweets: data.data ?? [], authorsById };
}

export async function fetchTwitterArticles(
  accessToken: string,
  options: { likesLimit?: number; bookmarksLimit?: number } = {},
): Promise<{ likes: TweetArticle[]; bookmarks: TweetArticle[] }> {
  const { likesLimit = 25, bookmarksLimit = 25 } = options;
  const userId = await fetchTwitterUserId(accessToken);

  const [liked, bookmarked] = await Promise.all([
    fetchTweets(accessToken, userId, "liked_tweets", likesLimit),
    fetchTweets(accessToken, userId, "bookmarks", bookmarksLimit),
  ]);

  // Deduped only within each type — the same tweet can legitimately be both liked
  // and bookmarked, and should appear in both feeds since they're shown separately.
  function toArticles(
    result: { tweets: Tweet[]; authorsById: Map<string, TwitterUser> },
    tweetType: "like" | "bookmark",
  ): TweetArticle[] {
    const seen = new Set<string>();
    const articles: TweetArticle[] = [];
    for (const tweet of result.tweets) {
      if (seen.has(tweet.id)) continue;
      seen.add(tweet.id);
      articles.push(extractArticleFromTweet(tweet, tweetType, result.authorsById));
    }
    return articles;
  }

  return {
    likes: toArticles(liked, "like"),
    bookmarks: toArticles(bookmarked, "bookmark"),
  };
}
