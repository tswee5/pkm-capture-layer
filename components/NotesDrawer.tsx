"use client";

import { useState } from "react";

interface NotesDrawerProps {
  personalNotes: string;
  chatSummary: string;
  onSavePersonalNotes: (value: string) => void;
  onSaveChatSummary: (value: string) => void;
}

export function NotesDrawer({
  personalNotes,
  chatSummary,
  onSavePersonalNotes,
  onSaveChatSummary,
}: NotesDrawerProps) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(personalNotes);
  const [chat, setChat] = useState(chatSummary);

  return (
    <div className="border-t border-border pt-3">
      <button
        onClick={() => setOpen(!open)}
        className="min-h-[36px] text-sm text-text-secondary hover:text-text-primary"
      >
        {open ? "Hide notes" : "Notes & chat summary"}
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-text-secondary">
              Personal notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => onSavePersonalNotes(notes)}
              rows={3}
              placeholder="Your own summary and understanding..."
              className="w-full rounded-md border border-border bg-surface p-2 text-base text-text-primary outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-text-secondary">
              Chat summary
            </label>
            <textarea
              value={chat}
              onChange={(e) => setChat(e.target.value)}
              onBlur={() => onSaveChatSummary(chat)}
              rows={3}
              placeholder="Paste in a summary from a Claude or ChatGPT conversation..."
              className="w-full rounded-md border border-border bg-surface p-2 text-base text-text-primary outline-none focus:border-accent"
            />
          </div>
        </div>
      )}
    </div>
  );
}
