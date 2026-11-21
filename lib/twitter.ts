// Twitter OAuth token handling + bookmark/like fetching + the DB sync itself.
//
// No Next-only APIs or "@/" aliases here: syncTwitter() runs from
// captureItem() (lib/capture.ts) before every manual capture, and that file
// is also imported relatively by the standalone mcp-server/. The Supabase
// client is passed in (cookie client, service-role client, whatever the
// caller has), typed structurally — see SupabaseLike in lib/capture.ts.

interface SupabaseLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

interface TwitterToken {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  last_synced_at?: string | null;
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

  if (!res.ok) throw new Error(`Twitter token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function loadIntegration(supabase: SupabaseLike, userId: string): Promise<TwitterToken | null> {
  const { data, error } = await supabase
    .from("user_integrations")
    .select("access_token, refresh_token, expires_at, last_synced_at")
    .eq("user_id", userId)
    .eq("provider", "twitter")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TwitterToken | null) ?? null;
}

async function validAccessToken(supabase: SupabaseLike, userId: string, token: TwitterToken): Promise<string> {
  const expiresAt = token.expires_at ? new Date(token.expires_at).getTime() : 0;
  const isExpired = expiresAt > 0 && expiresAt < Date.now() + 60 * 1000;
  if (!isExpired) return token.access_token;

  if (!token.refresh_token) throw new Error("Twitter token expired and no refresh token stored");

  const refreshed = await refreshTwitterToken(token.refresh_token);
  // Twitter rotates refresh tokens: the old one is dead the moment this
  // succeeds, so persisting the new one is not optional.
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

export async function getValidTwitterAccessToken(supabase: SupabaseLike, userId: string): Promise<string> {
  const token = await loadIntegration(supabase, userId);
  if (!token) throw new Error("Twitter is not connected for this user");
  return validAccessToken(supabase, userId, token);
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
  externalUrl: string | null;
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
  note_tweet?: { text: string };
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

function isTwitterHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return ["twitter.com", "x.com", "t.co", "mobile.twitter.com"].includes(host);
  } catch {
    return true;
  }
}

export function extractArticleFromTweet(
  tweet: Tweet,
  tweetType: "like" | "bookmark",
  authorsById: Map<string, TwitterUser>,
): TweetArticle {
  const urls = tweet.entities?.urls ?? [];
  const externalUrl = urls.find((u) => !isTwitterHost(u.expanded_url))?.expanded_url ?? null;

  const author = tweet.author_id ? authorsById.get(tweet.author_id) : undefined;
  // `link` is always the tweet itself now — the card renders the tweet, and
  // any article it links to is surfaced separately (externalUrl). Previously
  // link was the external article, which made a bookmarked tweet look like a
  // plain link with no tweet attached.
  const link = author?.username
    ? `https://x.com/${author.username}/status/${tweet.id}`
    : `https://x.com/i/web/status/${tweet.id}`;

  // Long-form ("note") tweets truncate `text` at ~280 chars; note_tweet has
  // the full body.
  const fullText = tweet.note_tweet?.text ?? tweet.text;
  const cleanText = fullText.replace(/https?:\/\/t\.co\/\S+/g, "").replace(/[ \t]+\n/g, "\n").trim();
  const byline = author ? `${author.name} (@${author.username})` : "Tweet";
  const firstLine = cleanText.split("\n").find((l) => l.trim())?.trim() ?? "";
  const headline =
    firstLine.length > 0
      ? firstLine.length > 120
        ? `${firstLine.slice(0, 117).trimEnd()}…`
        : firstLine
      : `${byline} — media post`;

  return {
    tweetId: tweet.id,
    link,
    headline,
    summary: cleanText,
    tweetType,
    authorName: author?.name ?? null,
    authorHandle: author?.username ?? null,
    authorAvatarUrl: author?.profile_image_url ?? null,
    postedAt: tweet.created_at ?? null,
    externalUrl,
  };
}

async function fetchTweets(
  accessToken: string,
  userId: string,
  endpoint: "liked_tweets" | "bookmarks",
  maxResults: number,
): Promise<{ tweets: Tweet[]; authorsById: Map<string, TwitterUser> }> {
  const base = `https://api.twitter.com/2/users/${userId}/${endpoint}`;
  const tweets: Tweet[] = [];
  const authorsById = new Map<string, TwitterUser>();
  let paginationToken: string | undefined;

  // Pages of up to 100 (API max), most-recent-first, until maxResults.
  while (tweets.length < maxResults) {
    const url = new URL(base);
    url.searchParams.set("tweet.fields", "entities,created_at,author_id,note_tweet");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "name,username,profile_image_url");
    url.searchParams.set("max_results", String(Math.min(100, Math.max(5, maxResults - tweets.length))));
    if (paginationToken) url.searchParams.set("pagination_token", paginationToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Twitter ${endpoint} request failed (${res.status}): ${body}`);
    }

    const data: {
      data?: Tweet[];
      includes?: { users?: TwitterUser[] };
      meta?: { next_token?: string };
    } = await res.json();
    for (const u of data.includes?.users ?? []) authorsById.set(u.id, u);
    tweets.push(...(data.data ?? []));
    paginationToken = data.meta?.next_token;
    if (!paginationToken || (data.data ?? []).length === 0) break;
  }

  return { tweets: tweets.slice(0, maxResults), authorsById };
}

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

// The Twitter API doesn't expose *when* something was bookmarked — only the
// order (most-recently-bookmarked first). The feed sorts by
// last_captured_at, so each newly-seen bookmark needs an estimated
// timestamp. Two regimes:
//
//  - "live": the previous sync was recent. Sync runs on every dashboard load
//    and before every manual capture (lib/capture.ts), so any bookmark made
//    before a capture is already stored before that capture is written — a
//    bookmark first seen now was made after the last capture, and stamping it
//    "now" (minus 1ms per position to keep API order) is exact relative to
//    everything else in the feed.
//  - "backfill": first sync, or the last one was long ago. Stamping weeks of
//    bookmarks "now" would bury the feed under them, so use the tweet's own
//    post time as a stand-in (a bookmark can't predate its tweet), forced
//    non-increasing down the list so API order is still respected, and never
//    earlier than the previous sync if there was one.
export const BACKFILL_GAP_MS = 7 * 24 * 60 * 60 * 1000;

export function estimateBookmarkTimes(
  postedAts: (string | null)[],
  now: Date,
  lastSyncedAt: string | null,
): Date[] {
  const nowMs = now.getTime();
  const lastMs = lastSyncedAt ? new Date(lastSyncedAt).getTime() : null;
  const backfill = lastMs === null || nowMs - lastMs > BACKFILL_GAP_MS;

  const n = postedAts.length;
  const out: Date[] = [];
  let prev = nowMs + 1;
  postedAts.forEach((posted, i) => {
    let t = prev - 1;
    if (backfill) {
      const postedMs = posted ? new Date(posted).getTime() : NaN;
      if (Number.isFinite(postedMs)) t = Math.min(postedMs, t);
      // Everything first seen in this sync was bookmarked after the previous
      // one; strictly-decreasing floors above it keep list order intact.
      if (lastMs !== null) t = Math.max(t, lastMs + (n - i));
    }
    t = Math.floor(t);
    out.push(new Date(t));
    prev = t;
  });
  return out;
}

export interface SyncResult {
  connected: boolean;
  skipped?: "throttled";
  inserted: number;
  existing: number;
}

// Liked tweets: NOT synced by default (the feed never shows them anyway).
// Set TWITTER_SYNC_LIKES=1 to start pulling them into the DB for the AI
// librarian — they land as source='twitter', tweet_type='like' and are
// excluded from the dashboard feed by its query.
function likesEnabled(): boolean {
  return process.env.TWITTER_SYNC_LIKES === "1";
}

export async function syncTwitter(
  supabase: SupabaseLike,
  userId: string,
  options: { minIntervalMs?: number } = {},
): Promise<SyncResult> {
  const integration = await loadIntegration(supabase, userId);
  if (!integration) return { connected: false, inserted: 0, existing: 0 };

  const now = new Date();
  const lastSyncedAt = integration.last_synced_at ?? null;
  if (
    options.minIntervalMs &&
    lastSyncedAt &&
    now.getTime() - new Date(lastSyncedAt).getTime() < options.minIntervalMs
  ) {
    return { connected: true, skipped: "throttled", inserted: 0, existing: 0 };
  }

  const accessToken = await validAccessToken(supabase, userId, integration);
  const twitterUserId = await fetchTwitterUserId(accessToken);
  const backfill = !lastSyncedAt || now.getTime() - new Date(lastSyncedAt).getTime() > BACKFILL_GAP_MS;

  // The bookmarks endpoint only ever returns the most recent 800.
  const [bookmarkResult, likeResult] = await Promise.all([
    fetchTweets(accessToken, twitterUserId, "bookmarks", backfill ? 200 : 25),
    likesEnabled()
      ? fetchTweets(accessToken, twitterUserId, "liked_tweets", backfill ? 100 : 25)
      : Promise.resolve(null),
  ]);

  let inserted = 0;
  let existingCount = 0;

  const lists: TweetArticle[][] = [toArticles(bookmarkResult, "bookmark")];
  if (likeResult) lists.push(toArticles(likeResult, "like"));

  for (const list of lists) {
    if (list.length === 0) continue;
    const tweetType = list[0].tweetType;
    const { data: existingRows, error: existingError } = await supabase
      .from("articles")
      .select("tweet_id")
      .eq("user_id", userId)
      .eq("source", "twitter")
      .eq("tweet_type", tweetType)
      .in("tweet_id", list.map((t) => t.tweetId));
    if (existingError) throw new Error(existingError.message);
    const known = new Set((existingRows ?? []).map((r: { tweet_id: string }) => r.tweet_id));

    const fresh = list.filter((t) => !known.has(t.tweetId));
    existingCount += list.length - fresh.length;
    if (fresh.length === 0) continue;

    const times = estimateBookmarkTimes(fresh.map((t) => t.postedAt), now, lastSyncedAt);

    for (let i = 0; i < fresh.length; i++) {
      const tweet = fresh[i];
      const { error } = await supabase.from("articles").insert({
        user_id: userId,
        source: "twitter",
        link: tweet.link,
        headline: tweet.headline,
        summary: tweet.summary,
        // Folded into search_vector, so tweet text + author are searchable.
        extracted_text: [tweet.summary, tweet.authorName, tweet.authorHandle && `@${tweet.authorHandle}`, tweet.externalUrl]
          .filter(Boolean)
          .join("\n"),
        domain: "x.com",
        status: "pending",
        tweet_id: tweet.tweetId,
        tweet_type: tweet.tweetType,
        tweet_author_name: tweet.authorName,
        tweet_author_handle: tweet.authorHandle,
        tweet_author_avatar_url: tweet.authorAvatarUrl,
        tweet_posted_at: tweet.postedAt,
        last_captured_at: times[i].toISOString(),
      });
      if (error) {
        if (error.code === "23505") {
          existingCount++; // a concurrent sync got there first
          continue;
        }
        throw new Error(error.message);
      }
      inserted++;
    }
  }

  await supabase
    .from("user_integrations")
    .update({ last_synced_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("provider", "twitter");

  return { connected: true, inserted, existing: existingCount };
}

// For callers that must never fail or stall because of Twitter (the capture
// path): bounded by a timeout, errors logged and swallowed.
export async function syncTwitterQuietly(
  supabase: SupabaseLike,
  userId: string,
  timeoutMs = 6000,
): Promise<SyncResult | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      syncTwitter(supabase, userId),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch (err) {
    console.error("[twitter] background sync failed:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
