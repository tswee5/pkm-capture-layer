"use client";

import { useState } from "react";
import type { Article, DepthFlag, Topic } from "@/types";
import { TriageButtons } from "@/components/TriageButtons";
import { NotesDrawer } from "@/components/NotesDrawer";

const SOURCE_LABELS: Record<Article["source"], string> = {
  tldr: "TLDR",
  tldr_ai: "TLDR AI",
  twitter: "Twitter",
  manual: "Manual",
};

// Distinct color per source so TLDR and TLDR AI are visually easy to tell apart
// at a glance, not just by reading the small-caps text.
const SOURCE_BADGE_STYLES: Record<Article["source"], string> = {
  tldr: "bg-accent/15 text-accent",
  tldr_ai: "bg-deep/15 text-deep",
  twitter: "bg-sky-500/15 text-sky-500",
  manual: "bg-bg text-text-secondary",
};

interface ArticleCardProps {
  article: Article;
  allTopics: Topic[];
  onTriage: (status: Article["status"]) => void;
  onDepthChange: (depth: DepthFlag) => void;
  onSavePersonalNotes: (value: string) => void;
  onSaveChatSummary: (value: string) => void;
  onToggleTopic: (topicId: string, linked: boolean) => void;
}

export function ArticleCard({
  article,
  allTopics,
  onTriage,
  onDepthChange,
  onSavePersonalNotes,
  onSaveChatSummary,
  onToggleTopic,
}: ArticleCardProps) {
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  const linkedTopicIds = new Set((article.topics ?? []).map((t) => t.id));

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <span
            className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${SOURCE_BADGE_STYLES[article.source]}`}
          >
            {SOURCE_LABELS[article.source]}
          </span>
          {article.link ? (
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-semibold leading-snug text-text-primary hover:text-accent"
            >
              {article.headline}
            </a>
          ) : (
            <span className="text-lg font-semibold leading-snug text-text-primary">
              {article.headline}
            </span>
          )}
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
          <TriageButtons
            status={article.status}
            onKeep={() => onTriage("keep")}
            onPurge={() => onTriage("purge")}
          />
        </div>
      </div>

      {article.summary && (
        <p className="text-base leading-relaxed text-text-secondary">
          {article.summary}
        </p>
      )}

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
                <p className="px-1 py-1 text-xs text-text-secondary">
                  No topics yet
                </p>
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

      <NotesDrawer
        personalNotes={article.personal_notes ?? ""}
        chatSummary={article.chat_summary ?? ""}
        onSavePersonalNotes={onSavePersonalNotes}
        onSaveChatSummary={onSaveChatSummary}
      />
    </div>
  );
}
