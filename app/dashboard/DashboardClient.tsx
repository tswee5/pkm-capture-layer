"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { ItemCard } from "@/components/ItemCard";
import { QuickCapture } from "@/components/QuickCapture";
import { FilterBar } from "@/components/FilterBar";
import type { Article, DepthFlag, Topic } from "@/types";

interface DashboardClientProps {
  userEmail?: string;
}

export function DashboardClient({ userEmail }: DashboardClientProps) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [tags, setTags] = useState<Topic[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [readingMode, setReadingMode] = useState<DepthFlag | null>(null);
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "error" | "disconnected">("idle");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    if (type === "error") return;
    setTimeout(() => setToast(null), 4000);
  };

  const loadArticles = useCallback(async () => {
    const params = new URLSearchParams({ feed: "1" });
    if (readingMode) params.set("depth_flag", readingMode);
    if (unreadOnly) params.set("read", "unread");
    if (search.trim()) params.set("q", search.trim());
    const res = await fetch(`/api/articles?${params.toString()}`);
    if (res.ok) setArticles(await res.json());
  }, [readingMode, search, unreadOnly]);

  const loadTags = useCallback(async () => {
    const res = await fetch("/api/topics");
    if (res.ok) setTags(await res.json());
  }, []);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for an in-flight fetch triggered by filter changes, not a render-time computation
    setLoading(true);
    Promise.all([loadArticles(), loadTags()]).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [loadArticles, loadTags]);

  // Pull new X bookmarks into the feed. Throttled server-side to once a
  // minute unless forced (the Sync button). Captures also sync first, server
  // side, so bookmark-vs-link order holds even without this — see
  // estimateBookmarkTimes in lib/twitter.ts.
  const syncBookmarks = useCallback(
    async (force: boolean) => {
      setSyncState("syncing");
      try {
        const res = await fetch(`/api/sync/twitter${force ? "?force=1" : ""}`, { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSyncState("error");
          if (force) showToast(`Couldn't sync X bookmarks: ${body.error ?? res.statusText}`, "error");
          return;
        }
        if (body.connected === false) {
          setSyncState("disconnected");
          return;
        }
        setSyncState("idle");
        if (body.inserted > 0) {
          await loadArticles();
          if (force) showToast(`Added ${body.inserted} new bookmark${body.inserted > 1 ? "s" : ""}`, "success");
        } else if (force) {
          showToast("No new bookmarks", "success");
        }
      } catch {
        setSyncState("error");
      }
    },
    [loadArticles],
  );

  useEffect(() => {
    // Once per page load; filter changes shouldn't re-sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off an async fetch; state updates happen after it resolves
    syncBookmarks(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateArticleLocally = (id: string, patch: Partial<Article>) => {
    setArticles((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const handleCapture = async (input: {
    url: string;
    notes?: string;
    quote?: string;
    depth_flag?: DepthFlag | null;
    tag_ids: string[];
  }): Promise<boolean> => {
    try {
      const res = await fetch("/api/articles/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(`Couldn't save that link: ${body.error ?? res.statusText}`, "error");
        return false;
      }
      const article = await res.json();
      if (article.merged) {
        setArticles((prev) => [article, ...prev.filter((a) => a.id !== article.id)]);
        showToast(
          article.quoteAdded && !article.noteAppended
            ? "Quote added to existing item"
            : "Added to existing item",
          "success",
        );
      } else {
        setArticles((prev) => [article, ...prev]);
      }
      loadTags();
      return true;
    } catch {
      showToast("Couldn't save that link — check your connection.", "error");
      return false;
    }
  };

  const handleDeleteHighlight = async (articleId: string, highlightId: string) => {
    setArticles((prev) =>
      prev.map((a) =>
        a.id === articleId
          ? { ...a, highlights: (a.highlights ?? []).filter((h) => h.id !== highlightId) }
          : a,
      ),
    );
    await fetch(`/api/highlights/${highlightId}`, { method: "DELETE" });
  };

  const handleSaveNotes = async (id: string, personal_notes: string) => {
    updateArticleLocally(id, { personal_notes });
    await fetch("/api/articles/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article_id: id, personal_notes }),
    });
  };

  const handleSaveTitle = async (id: string, headline: string) => {
    updateArticleLocally(id, { headline });
    const res = await fetch("/api/articles/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article_id: id, headline }),
    });
    if (!res.ok) showToast("Couldn't save the title change.", "error");
  };

  const handleToggleRead = async (id: string, read: boolean) => {
    const read_at = read ? new Date().toISOString() : null;
    updateArticleLocally(id, { read_at });
    const res = await fetch("/api/articles/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article_id: id, read }),
    });
    if (!res.ok) {
      updateArticleLocally(id, { read_at: read ? null : read_at });
      showToast("Couldn't update read status.", "error");
    }
  };

  const handleSetReadingMode = async (id: string, depth_flag: DepthFlag | null) => {
    updateArticleLocally(id, { depth_flag });
    await fetch("/api/articles/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article_id: id, depth_flag }),
    });
  };

  const handleToggleTag = async (articleId: string, tagId: string, linked: boolean) => {
    const article = articles.find((a) => a.id === articleId);
    if (!article) return;
    const tag = tags.find((t) => t.id === tagId);
    const nextTags = linked
      ? [...(article.topics ?? []), tag!]
      : (article.topics ?? []).filter((t) => t.id !== tagId);
    updateArticleLocally(articleId, { topics: nextTags });

    if (linked) {
      await fetch("/api/articles/link-topic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article_id: articleId, topic_id: tagId }),
      });
    } else {
      await fetch(`/api/articles/link-topic?article_id=${articleId}&topic_id=${tagId}`, {
        method: "DELETE",
      });
    }
    loadTags();
  };

  const handleCreateTag = async (name: string): Promise<Topic | void> => {
    const res = await fetch("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const tag = await res.json();
      setTags((prev) => [...prev, tag]);
      return tag;
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this saved item? This can't be undone.")) return;
    setArticles((prev) => prev.filter((a) => a.id !== id));
    await fetch(`/api/articles/${id}`, { method: "DELETE" });
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const visibleArticles = selectedTagId
    ? articles.filter((a) => (a.topics ?? []).some((t) => t.id === selectedTagId))
    : articles;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight text-text-primary">Capture</span>
        <div className="flex items-center gap-3">
          {syncState === "disconnected" || syncState === "error" ? (
            <a
              href="/api/auth/twitter"
              className="text-xs text-text-secondary hover:text-text-primary"
              title={syncState === "error" ? "Bookmark sync failed — reconnecting X usually fixes an expired login" : undefined}
            >
              {syncState === "error" ? "Reconnect X" : "Connect X"}
            </a>
          ) : (
            <button
              onClick={() => syncBookmarks(true)}
              disabled={syncState === "syncing"}
              className="text-xs text-text-secondary hover:text-text-primary disabled:opacity-60"
            >
              {syncState === "syncing" ? "Syncing X…" : "Sync X"}
            </button>
          )}
          {userEmail && <span className="hidden text-xs text-text-secondary sm:inline">{userEmail}</span>}
          <button onClick={handleSignOut} className="text-xs text-text-secondary hover:text-text-primary">
            Sign out
          </button>
        </div>
      </header>

      <QuickCapture allTags={tags} onCreateTag={handleCreateTag} onCapture={handleCapture} />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        tags={tags}
        selectedTagId={selectedTagId}
        onSelectTag={setSelectedTagId}
        readingMode={readingMode}
        onSelectReadingMode={setReadingMode}
        unreadOnly={unreadOnly}
        onToggleUnreadOnly={() => setUnreadOnly((v) => !v)}
      />

      <main className="flex flex-col gap-3">
        {loading ? (
          <p className="text-sm text-text-secondary">Loading...</p>
        ) : visibleArticles.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Nothing saved yet — paste a link above to get started.
          </p>
        ) : (
          visibleArticles.map((article) => (
            <ItemCard
              key={article.id}
              article={article}
              allTags={tags}
              onSaveNotes={(notes) => handleSaveNotes(article.id, notes)}
              onSaveTitle={(headline) => handleSaveTitle(article.id, headline)}
              onSetReadingMode={(mode) => handleSetReadingMode(article.id, mode)}
              onToggleRead={(read) => handleToggleRead(article.id, read)}
              onToggleTag={(tagId, linked) => handleToggleTag(article.id, tagId, linked)}
              onCreateTag={handleCreateTag}
              onDelete={() => handleDelete(article.id)}
              onDeleteHighlight={(highlightId) => handleDeleteHighlight(article.id, highlightId)}
            />
          ))
        )}
      </main>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-md rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg transition-all ${
            toast.type === "success" ? "bg-keep" : "bg-purge"
          }`}
        >
          <div className="flex items-start gap-3">
            <span className="whitespace-pre-wrap break-words">{toast.message}</span>
            {toast.type === "error" && (
              <button
                onClick={() => setToast(null)}
                className="shrink-0 opacity-80 hover:opacity-100"
                aria-label="Dismiss"
              >
                ×
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
