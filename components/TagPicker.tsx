"use client";

import { useRef, useState } from "react";
import type { Topic } from "@/types";

interface TagPickerProps {
  allTags: Topic[];
  selectedTagIds: Set<string>;
  onToggleTag: (tagId: string) => void;
  onCreateTag: (name: string) => Promise<Topic | void>;
  align?: "left" | "right";
}

export function TagPicker({ allTags, selectedTagIds, onToggleTag, onCreateTag, align = "left" }: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const handleCreate = async () => {
    const name = newTagName.trim();
    if (!name) return;
    const tag = await onCreateTag(name);
    if (tag && "id" in tag) onToggleTag(tag.id);
    setNewTagName("");
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="min-h-[32px] rounded-full border border-border px-3 py-1 text-xs font-medium text-text-secondary hover:border-accent hover:text-text-primary"
      >
        {selectedTagIds.size > 0 ? `${selectedTagIds.size} tag${selectedTagIds.size > 1 ? "s" : ""}` : "+ Tag"}
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className={`absolute top-full z-20 mt-1 w-56 rounded-lg border border-border bg-surface p-2 shadow-lg ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
              {allTags.length === 0 && (
                <p className="px-1.5 py-1 text-xs text-text-secondary">No tags yet</p>
              )}
              {allTags.map((tag) => {
                const checked = selectedTagIds.has(tag.id);
                return (
                  <label
                    key={tag.id}
                    className="flex min-h-[32px] cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-text-primary hover:bg-bg"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleTag(tag.id)}
                      className="accent-accent"
                    />
                    {tag.name}
                  </label>
                );
              })}
            </div>
            <div className="mt-2 flex gap-1 border-t border-border pt-2">
              <input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                placeholder="New tag"
                className="min-h-[32px] flex-1 rounded-md border border-border bg-bg px-2 text-sm text-text-primary outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={handleCreate}
                className="min-h-[32px] rounded-md bg-accent px-2 text-xs font-medium text-white hover:bg-accent-hover"
              >
                Add
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
