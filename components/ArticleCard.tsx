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
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            {SOURCE_LABELS[article.source]}
          </span>
          {article.link ? (
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-semibold text-text-primary hover:text-accent"
            >
              {article.headline}
            </a>
          ) : (
            <span className="text-base font-semibold text-text-primary">
              {article.headline}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border">
            <button
              onClick={() => onDepthChange("surface")}
              title="Surface read"
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
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
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
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
        <p className="text-sm leading-relaxed text-text-secondary">
          {article.summary}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <button
            onClick={() => setTopicMenuOpen(!topicMenuOpen)}
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text-primary"
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
