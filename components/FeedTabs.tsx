"use client";

import type { TweetType } from "@/types";

export type FeedSource = "tldr" | "tldr_ai" | "twitter" | "manual";

const SOURCE_TABS: { value: FeedSource; label: string }[] = [
  { value: "tldr", label: "TLDR" },
  { value: "tldr_ai", label: "TLDR AI" },
  { value: "twitter", label: "Twitter" },
  { value: "manual", label: "Manual" },
];

const TWITTER_SUB_TABS: { value: TweetType; label: string }[] = [
  { value: "like", label: "Likes" },
  { value: "bookmark", label: "Bookmarks" },
];

interface FeedTabsProps {
  activeSource: FeedSource;
  onSelectSource: (source: FeedSource) => void;
  twitterSubTab: TweetType;
  onSelectTwitterSubTab: (type: TweetType) => void;
}

export function FeedTabs({
  activeSource,
  onSelectSource,
  twitterSubTab,
  onSelectTwitterSubTab,
}: FeedTabsProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 overflow-x-auto">
        {SOURCE_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => onSelectSource(tab.value)}
            className={`min-h-[40px] shrink-0 rounded-md px-3.5 py-2 text-sm font-medium transition-colors ${
              activeSource === tab.value
                ? "bg-accent text-white"
                : "text-text-secondary hover:bg-surface hover:text-text-primary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeSource === "twitter" && (
        <div className="flex gap-1">
          {TWITTER_SUB_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => onSelectTwitterSubTab(tab.value)}
              className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                twitterSubTab === tab.value
                  ? "bg-sky-500/15 text-sky-500"
                  : "text-text-secondary hover:bg-surface hover:text-text-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
