"use client";

import { useState } from "react";
import { ArticleCard } from "@/components/ArticleCard";
import type { Article, DepthFlag, Status, Topic } from "@/types";

interface DayGroupProps {
  date: string; // "2026-07-17" or "manual" etc.
  articles: Article[];
  allTopics: Topic[];
  defaultExpanded: boolean;
  onTriage: (id: string, patch: { status?: Status; depth_flag?: DepthFlag; personal_notes?: string; chat_summary?: string }) => void;
  onToggleTopic: (articleId: string, topicId: string, linked: boolean) => void;
}

function formatDate(dateStr: string): string {
  if (dateStr === "other") return "Other";
  try {
    const d = new Date(dateStr + "T12:00:00Z");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  } catch {
    return dateStr;
  }
}

export function DayGroup({ date, articles, allTopics, defaultExpanded, onTriage, onToggleTopic }: DayGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  let lastSection: string | null = undefined as unknown as null;

  return (
    <div className="flex flex-col gap-0">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-2 rounded-md px-1 py-2 text-left hover:bg-surface"
      >
        <span className={`text-xs transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
        <span className="text-sm font-semibold text-text-primary">{formatDate(date)}</span>
        <span className="text-xs text-text-secondary">({articles.length})</span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 pb-4 pl-4">
          {articles.map((article) => {
            const showSection = article.section_label !== lastSection;
            lastSection = article.section_label;
            return (
              <div key={article.id}>
                {showSection && article.section_label && (
                  <div className="mb-2 mt-3 text-xs font-semibold uppercase tracking-widest text-text-secondary">
                    {article.section_label}
                  </div>
                )}
                <ArticleCard
                  article={article}
                  allTopics={allTopics}
                  onTriage={(status) => onTriage(article.id, { status })}
                  onDepthChange={(depth_flag) => onTriage(article.id, { depth_flag })}
                  onSavePersonalNotes={(personal_notes) => onTriage(article.id, { personal_notes })}
                  onSaveChatSummary={(chat_summary) => onTriage(article.id, { chat_summary })}
                  onToggleTopic={(topicId, linked) => onToggleTopic(article.id, topicId, linked)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
