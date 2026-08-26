"use client";

import { useState } from "react";
import type { Article, DepthFlag, Topic } from "@/types";
import { TriageButtons } from "@/components/TriageButtons";
import { NotesDrawer } from "@/components/NotesDrawer";

interface TweetCardProps {
  article: Article;
  allTopics: Topic[];
  onTriage: (status: Article["status"]) => void;
  onDepthChange: (depth: DepthFlag) => void;
  onSavePersonalNotes: (value: string) => void;
  onSaveChatSummary: (value: string) => void;
  onToggleTopic: (topicId: string, linked: boolean) => void;
}

function formatTweetDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

// Tweets whose only link is the tweet itself (no external article) fall back to
// this URL shape from lib/twitter.ts — anything else is a real linked article.
function isExternalLink(link: string | null): link is string {
  return !!link && !/^https:\/\/twitter\.com\/i\/web\/status\//.test(link);
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function TweetCard({
  article,
  allTopics,
  onTriage,
  onDepthChange,
  onSavePersonalNotes,
  onSaveChatSummary,
  onToggleTopic,
}: TweetCardProps) {
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  const linkedTopicIds = new Set((article.topics ?? []).map((t) => t.id));

  const postedDate = formatTweetDate(article.tweet_posted_at);
  const externalLink = isExternalLink(article.link) ? article.link : null;
  const tweetUrl = article.link && !externalLink ? article.link : null;
  const initial = article.tweet_author_name?.[0] ?? article.tweet_author_handle?.[0] ?? "?";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {article.tweet_author_avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- external avatar URLs, not worth Next/Image config for this
            <img
              src={article.tweet_author_avatar_url}
              alt=""
              className="h-10 w-10 shrink-0 rounded-full"
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg text-sm font-semibold uppercase text-text-secondary">
              {initial}
            </div>
          )}
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-semibold text-text-primary">
              {article.tweet_author_name ?? "Unknown"}
            </span>
            <span className="truncate text-sm text-text-secondary">
              {article.tweet_author_handle ? `@${article.tweet_author_handle}` : ""}
              {postedDate && (article.tweet_author_handle ? ` · ${postedDate}` : postedDate)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border">
            <button
              onClick={() => onDepthChange("surface")}
              title="Surface read"
              className={`min-h-[36px] px-3 py-1.5 text-xs font-medium transition-colors ${
                article.depth_flag === "surface"
                  ? "bg-accent text-white"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Surface
            </button>
            <button
              onClick={() => onDepthChange("deep")}
              title="Deep dive"
              className={`min-h-[36px] px-3 py-1.5 text-xs font-medium transition-colors ${
                article.depth_flag === "deep"
                  ? "bg-deep text-white"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Deep
            </button>
          </div>
        </div>
      </div>

      {tweetUrl ? (
        <a
          href={tweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-pre-wrap text-base leading-relaxed text-text-primary hover:text-accent"
        >
          {article.summary || article.headline}
        </a>
      ) : (
        <p className="whitespace-pre-wrap text-base leading-relaxed text-text-primary">
          {article.summary || article.headline}
        </p>
      )}

      {externalLink && (
        <a
          href={externalLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col gap-0.5 rounded-lg border border-border bg-bg px-3 py-2.5 hover:border-accent"
        >
          <span className="text-xs uppercase tracking-wide text-text-secondary">
            {domainOf(externalLink)}
          </span>
          <span className="truncate text-sm font-medium text-text-primary">
            {article.headline}
          </span>
        </a>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setTopicMenuOpen(!topicMenuOpen)}
              className="min-h-[36px] rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
            >
              {linkedTopicIds.size > 0
                ? `${linkedTopicIds.size} topic${linkedTopicIds.size > 1 ? "s" : ""}`
                : "Add topic"}
            </button>
            {topicMenuOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-md border border-border bg-surface p-2 shadow-lg">
                {allTopics.length === 0 && (
                  <p className="px-1 py-1 text-xs text-text-secondary">No topics yet</p>
                )}
                {allTopics.map((topic) => {
                  const checked = linkedTopicIds.has(topic.id);
                  return (
                    <label
                      key={topic.id}
                      className="flex items-center gap-2 rounded px-1 py-1 text-sm text-text-primary hover:bg-bg"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleTopic(topic.id, !checked)}
                        className="accent-accent"
                      />
                      {topic.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {(article.topics ?? []).map((topic) => (
            <span
              key={topic.id}
              className="rounded-full bg-bg px-2.5 py-1 text-xs text-text-secondary"
            >
              {topic.name}
            </span>
          ))}
        </div>

        <TriageButtons
          status={article.status}
          onKeep={() => onTriage("keep")}
          onPurge={() => onTriage("purge")}
        />
      </div>

      <NotesDrawer
        personalNotes={article.personal_notes ?? ""}
        chatSummary={article.chat_summary ?? ""}
        onSavePersonalNotes={onSavePersonalNotes}
        onSaveChatSummary={onSaveChatSummary}
      />
    </div>
  );
}
