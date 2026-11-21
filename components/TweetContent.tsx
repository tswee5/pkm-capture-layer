"use client";

import { Tweet } from "react-tweet";
import type { Article } from "@/types";
import { decodeHtmlEntities } from "@/lib/htmlEntities";

function formatPosted(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Rendered from our own stored columns — used when the live embed can't load
// (deleted/protected tweet, syndication API hiccup) so a bookmark never shows
// up as an empty box.
function StoredTweet({ article }: { article: Article }) {
  const posted = formatPosted(article.tweet_posted_at);
  const initial = article.tweet_author_name?.[0] ?? article.tweet_author_handle?.[0] ?? "?";
  return (
    <a
      href={article.link ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-3 hover:border-accent"
    >
      <div className="flex items-center gap-2.5">
        {article.tweet_author_avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- external avatar URL
          <img src={article.tweet_author_avatar_url} alt="" className="h-8 w-8 shrink-0 rounded-full" />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold uppercase text-text-secondary">
            {initial}
          </div>
        )}
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold text-text-primary">
            {article.tweet_author_name ?? "Unknown"}
          </span>
          <span className="truncate text-xs text-text-secondary">
            {article.tweet_author_handle ? `@${article.tweet_author_handle}` : ""}
            {posted && (article.tweet_author_handle ? ` · ${posted}` : posted)}
          </span>
        </div>
      </div>
      {article.summary && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
          {decodeHtmlEntities(article.summary)}
        </p>
      )}
    </a>
  );
}

export function TweetContent({ article }: { article: Article }) {
  if (!article.tweet_id) return <StoredTweet article={article} />;
  return (
    // react-tweet ships its own margins/max-width for standalone embeds;
    // inside a card it should just fill the column.
    <div className="tweet-embed [&_.react-tweet-theme]:!m-0 [&_.react-tweet-theme]:!max-w-full [&_.react-tweet-theme]:!min-w-0">
      <Tweet
        id={article.tweet_id}
        apiUrl={`/api/tweet/${article.tweet_id}`}
        components={{ TweetNotFound: () => <StoredTweet article={article} /> }}
      />
    </div>
  );
}
