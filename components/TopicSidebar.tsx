"use client";

import { useState } from "react";
import type { Topic } from "@/types";

interface TopicSidebarProps {
  topics: Topic[];
  selectedTopicId: string | null;
  onSelectTopic: (topicId: string | null) => void;
  onCreateTopic: (name: string) => void;
  userEmail?: string;
  onSignOut: () => void;
  open: boolean;
  onClose: () => void;
  gmailConnected: boolean;
  gmailSyncing: boolean;
  gmailLastSyncedAt: string | null;
  onConnectGmail: () => void;
  onSyncGmail: () => void;
  twitterConnected: boolean;
  twitterSyncing: boolean;
  twitterLastSyncedAt: string | null;
  onConnectTwitter: () => void;
  onSyncTwitter: () => void;
}

export function TopicSidebar({
  topics,
  selectedTopicId,
  onSelectTopic,
  onCreateTopic,
  userEmail,
  onSignOut,
  open,
  onClose,
  gmailConnected,
  gmailSyncing,
  gmailLastSyncedAt,
  onConnectGmail,
  onSyncGmail,
  twitterConnected,
  twitterSyncing,
  twitterLastSyncedAt,
  onConnectTwitter,
  onSyncTwitter,
}: TopicSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [newTopicName, setNewTopicName] = useState("");

  const handleCreate = () => {
    if (newTopicName.trim()) {
      onCreateTopic(newTopicName.trim());
      setNewTopicName("");
      setCreating(false);
    }
  };

  return (
    <>
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-surface p-4 transition-transform duration-200 ease-out md:relative md:z-auto md:w-60 md:max-w-none md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
      <div className="mb-6 flex items-center justify-between">
        <span className="text-lg font-semibold text-text-primary">Capture</span>
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:text-text-primary md:hidden"
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>

      <nav className="flex flex-col gap-1">
        <button
          onClick={() => onSelectTopic(null)}
          className={`min-h-[44px] rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
            selectedTopicId === null
              ? "bg-accent text-white"
              : "text-text-secondary hover:bg-bg hover:text-text-primary"
          }`}
        >
          All topics
        </button>
        {topics.map((topic) => (
          <button
            key={topic.id}
            onClick={() => onSelectTopic(topic.id)}
            className={`flex min-h-[44px] items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
              selectedTopicId === topic.id
                ? "bg-accent text-white"
                : "text-text-secondary hover:bg-bg hover:text-text-primary"
            }`}
          >
            <span className="truncate">{topic.name}</span>
            <span className="text-xs opacity-70">{topic.article_count ?? 0}</span>
          </button>
        ))}
      </nav>

      {creating ? (
        <div className="mt-3 flex flex-col gap-2">
          <input
            autoFocus
            value={newTopicName}
            onChange={(e) => setNewTopicName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="Topic name"
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="flex-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover"
            >
              Add
            </button>
            <button
              onClick={() => setCreating(false)}
              className="flex-1 rounded-md border border-border px-2 py-1 text-xs text-text-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="mt-3 rounded-md border border-border px-2.5 py-1.5 text-left text-sm text-text-secondary hover:text-text-primary"
        >
          + New Topic
        </button>
      )}

      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
        <button
          onClick={gmailConnected ? onSyncGmail : onConnectGmail}
          disabled={gmailSyncing}
          className="min-h-[44px] rounded-md border border-border px-2.5 py-1.5 text-left text-sm text-text-secondary hover:text-text-primary disabled:opacity-50"
        >
          {gmailSyncing
            ? "Syncing..."
            : gmailConnected
              ? "Sync TLDR"
              : "Connect Gmail"}
        </button>
        <span className="text-xs text-text-secondary">
          {gmailConnected
            ? gmailLastSyncedAt
              ? `Last synced ${new Date(gmailLastSyncedAt).toLocaleString()}`
              : "Not synced yet"
            : "Gmail not connected"}
        </span>
        <button
          onClick={twitterConnected ? onSyncTwitter : onConnectTwitter}
          disabled={twitterSyncing}
          className="min-h-[44px] rounded-md border border-border px-2.5 py-1.5 text-left text-sm text-text-secondary hover:text-text-primary disabled:opacity-50"
        >
          {twitterSyncing
            ? "Syncing..."
            : twitterConnected
              ? "Sync Twitter"
              : "Connect Twitter"}
        </button>
        <span className="text-xs text-text-secondary">
          {twitterConnected
            ? twitterLastSyncedAt
              ? `Last synced ${new Date(twitterLastSyncedAt).toLocaleString()}`
              : "Not synced yet"
            : "Twitter not connected"}
        </span>
      </div>

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
        {userEmail && (
          <span className="truncate text-xs text-text-secondary">{userEmail}</span>
        )}
        <button
          onClick={onSignOut}
          className="text-left text-xs text-text-secondary hover:text-text-primary"
        >
          Sign out
        </button>
      </div>
      </aside>
    </>
  );
}
