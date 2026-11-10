"use client";

import { useState } from "react";
import type { Article, DepthFlag, Topic } from "@/types";
import { TagPicker } from "@/components/TagPicker";

export const READING_MODE_LABELS: Record<DepthFlag, string> = {
  surface: "Reference",
  deep: "Deep Dive",
};

function formatSavedDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface ItemCardProps {
  article: Article;
  allTags: Topic[];
  onSaveNotes: (value: string) => void;
  onSetReadingMode: (mode: DepthFlag | null) => void;
  onToggleTag: (tagId: string, linked: boolean) => void;
  onCreateTag: (name: string) => Promise<Topic | void>;
  onDelete: () => void;
}

export function ItemCard({
  article,
  allTags,
  onSaveNotes,
  onSetReadingMode,
  onToggleTag,
  onCreateTag,
  onDelete,
}: ItemCardProps) {
  const [notes, setNotes] = useState(article.personal_notes ?? "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const linkedTagIds = new Set((article.topics ?? []).map((t) => t.id));

  const handleToggleTag = (tagId: string) => {
    onToggleTag(tagId, !linkedTagIds.has(tagId));
  };

  return (
    <div className="group flex gap-4 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-text-secondary/30 sm:p-5">
      {article.og_image_url && (
        <a
          href={article.link ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden shrink-0 sm:block"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external og:image URLs */}
          <img
            src={article.og_image_url}
            alt=""
            className="h-20 w-20 rounded-lg object-cover"
          />
        </a>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {article.domain && (
              <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                {article.domain}
              </span>
            )}
            {article.link ? (
              <a
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-base font-semibold leading-snug text-text-primary hover:text-accent"
              >
                {article.headline}
              </a>
            ) : (
              <span className="text-base font-semibold leading-snug text-text-primary">
                {article.headline}
              </span>
            )}
          </div>

          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary opacity-0 transition-opacity hover:bg-bg hover:text-text-primary group-hover:opacity-100"
              aria-label="More options"
            >
              ⋯
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-md border border-border bg-surface p-1 shadow-lg">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm text-purge hover:bg-bg"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {article.og_description && !article.personal_notes && (
          <p className="line-clamp-2 text-sm leading-relaxed text-text-secondary">
            {article.og_description}
          </p>
        )}

        {editingNotes ? (
          <textarea
            autoFocus
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              setEditingNotes(false);
              onSaveNotes(notes);
            }}
            rows={3}
            placeholder="Why does this matter? What do you want to remember?"
            className="w-full rounded-md border border-border bg-bg p-2 text-sm text-text-primary outline-none focus:border-accent"
          />
        ) : notes ? (
          <button
            onClick={() => setEditingNotes(true)}
            className="whitespace-pre-wrap rounded-md bg-bg px-3 py-2 text-left text-sm leading-relaxed text-text-primary hover:bg-bg/70"
          >
            {notes}
          </button>
        ) : (
          <button
            onClick={() => setEditingNotes(true)}
            className="w-fit text-left text-sm text-text-secondary hover:text-text-primary"
          >
            + Add a note
          </button>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <TagPicker
              allTags={allTags}
              selectedTagIds={linkedTagIds}
              onToggleTag={handleToggleTag}
              onCreateTag={onCreateTag}
            />
            {(article.topics ?? []).map((tag) => (
              <span
                key={tag.id}
                className="rounded-full bg-bg px-2.5 py-1 text-xs text-text-secondary"
              >
                {tag.name}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">{formatSavedDate(article.created_at)}</span>
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["surface", "deep"] as DepthFlag[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onSetReadingMode(article.depth_flag === mode ? null : mode)}
                  className={`min-h-[28px] px-2 py-1 text-xs font-medium transition-colors ${
                    article.depth_flag === mode
                      ? mode === "deep"
                        ? "bg-deep text-white"
                        : "bg-accent text-white"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {READING_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
