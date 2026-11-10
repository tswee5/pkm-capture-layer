"use client";

import type { DepthFlag, Topic } from "@/types";
import { READING_MODE_LABELS } from "@/components/ItemCard";

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  tags: Topic[];
  selectedTagId: string | null;
  onSelectTag: (tagId: string | null) => void;
  readingMode: DepthFlag | null;
  onSelectReadingMode: (mode: DepthFlag | null) => void;
}

export function FilterBar({
  search,
  onSearchChange,
  tags,
  selectedTagId,
  onSelectTag,
  readingMode,
  onSelectReadingMode,
}: FilterBarProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search your saved items..."
        className="min-h-[40px] w-full rounded-lg border border-border bg-surface px-3 text-base text-text-primary outline-none focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => onSelectReadingMode(null)}
          className={`min-h-[32px] rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            readingMode === null
              ? "bg-text-primary text-bg"
              : "border border-border text-text-secondary hover:text-text-primary"
          }`}
        >
          All
        </button>
        {(["surface", "deep"] as DepthFlag[]).map((mode) => (
          <button
            key={mode}
            onClick={() => onSelectReadingMode(readingMode === mode ? null : mode)}
            className={`min-h-[32px] rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              readingMode === mode
                ? mode === "deep"
                  ? "bg-deep text-white"
                  : "bg-accent text-white"
                : "border border-border text-text-secondary hover:text-text-primary"
            }`}
          >
            {READING_MODE_LABELS[mode]}
          </button>
        ))}

        {tags.length > 0 && <span className="mx-1 h-4 w-px bg-border" />}

        {tags.map((tag) => (
          <button
            key={tag.id}
            onClick={() => onSelectTag(selectedTagId === tag.id ? null : tag.id)}
            className={`min-h-[32px] rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              selectedTagId === tag.id
                ? "bg-text-primary text-bg"
                : "border border-border text-text-secondary hover:text-text-primary"
            }`}
          >
            {tag.name}
            <span className="ml-1 opacity-60">{tag.article_count ?? 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
