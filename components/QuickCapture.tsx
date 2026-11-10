"use client";

import { useState } from "react";
import type { DepthFlag, Topic } from "@/types";
import { TagPicker } from "@/components/TagPicker";
import { READING_MODE_LABELS } from "@/components/ItemCard";

interface QuickCaptureProps {
  allTags: Topic[];
  onCreateTag: (name: string) => Promise<Topic | void>;
  onCapture: (input: { url: string; notes?: string; depth_flag?: DepthFlag | null; tag_ids: string[] }) => Promise<boolean>;
}

export function QuickCapture({ allTags, onCreateTag, onCapture }: QuickCaptureProps) {
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [depthFlag, setDepthFlag] = useState<DepthFlag | null>(null);
  const [tagIds, setTagIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setUrl("");
    setNotes("");
    setDepthFlag(null);
    setTagIds(new Set());
    setExpanded(false);
  };

  const handleSubmit = async () => {
    if (!url.trim() || saving) return;
    setSaving(true);
    try {
      const ok = await onCapture({
        url: url.trim(),
        notes: notes.trim() || undefined,
        depth_flag: depthFlag,
        tag_ids: Array.from(tagIds),
      });
      if (ok) reset();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3 sm:p-4">
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onFocus={() => setExpanded(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Paste a link to save..."
          className="min-h-[44px] flex-1 rounded-lg border border-border bg-bg px-3 text-base text-text-primary outline-none focus:border-accent"
        />
        <button
          onClick={handleSubmit}
          disabled={saving || !url.trim()}
          className="min-h-[44px] shrink-0 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-border pt-2.5">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Add a note (optional)..."
            className="w-full rounded-md border border-border bg-bg p-2 text-sm text-text-primary outline-none focus:border-accent"
          />
          <div className="flex flex-wrap items-center gap-2">
            <TagPicker
              allTags={allTags}
              selectedTagIds={tagIds}
              onToggleTag={(id) =>
                setTagIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onCreateTag={onCreateTag}
            />
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["surface", "deep"] as DepthFlag[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDepthFlag((prev) => (prev === mode ? null : mode))}
                  className={`min-h-[32px] px-2.5 py-1 text-xs font-medium transition-colors ${
                    depthFlag === mode
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
      )}
    </div>
  );
}
